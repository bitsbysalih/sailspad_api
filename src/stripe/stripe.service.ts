import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import Stripe from 'stripe';
import { ConfigService } from '@nestjs/config';
import { CreatePaymentIntentDto } from './dto/create-payment-intent.dto';
import { Users } from '@prisma/client';

@Injectable()
export class StripeService {
  private stripe: Stripe;
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    this.stripe = new Stripe(this.configService.get('stripe.secretKey'), {
      apiVersion: '2022-08-01',
    });
  }

  async processSubscriptionUpdate(event: any) {
    try {
      const data = event.data.object;
      const customerId: string = data.customer as string;
      const subscriptionStatus = data.status;

      switch (event.type) {
        case 'customer.subscription.updated':
          await this.updateMonthlySubscriptionStatus(
            customerId,
            subscriptionStatus,
          );
          break;
        case 'payment_intent.created':
          await this.updateMonthlySubscriptionStatus(
            customerId,
            subscriptionStatus,
          );
          break;
        case 'payment_intent.succeeded':
          console.log('Payment intent success');
        case 'customer.subscription.created':
          await this.newMonthlySubscriptionStatus(
            customerId,
            data,
            subscriptionStatus,
          );
          break;
        case 'customer.subscription.deleted':
          await this.updateMonthlySubscriptionStatus(
            customerId,
            subscriptionStatus,
          );
          //   this.sendCancellationEmail(data);
          break;
        case 'invoice.payment_succeeded':
          //   await this.sendSubscriptionInvoiceEmail(data);
          await this.updateCardSlotsCount(
            customerId,
            data.lines.data[0].quantity.toString(),
          );
          await this.setCardToDefault(data);
          break;
        default:
          break;
      }
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  async constructEventFromPayload(signature: string, payload: Buffer) {
    const webhookSecret = this.configService.get('stripe.webhookSecret');
    return this.stripe.webhooks.constructEvent(
      payload,
      signature,
      webhookSecret,
    );
  }

  async createCustomer(name: string, email: string) {
    try {
      return this.stripe.customers.create({
        name,
        email,
      });
    } catch (error) {
      throw new BadRequestException('error creating customer', error.message);
    }
  }

  async createMonthlySubscription(
    createPaymentIntent: CreatePaymentIntentDto,
    user: Users,
  ) {
    try {
      const monthlyPriceId = this.configService.get(
        'stripe.monthlySubscriptionId',
      );
      const yearlyPriceId = this.configService.get(
        'stripe.yearlySubscriptionId',
      );

      const subscriptions = await this.listSubscriptions(
        createPaymentIntent.yearlySubscription ? yearlyPriceId : monthlyPriceId,
        user.stripeCustomerId,
      );

      if (subscriptions.data.length) {
        throw new BadRequestException('Customer Already subscribed');
      }
      const subscription = await this.stripe.subscriptions.create({
        customer: user.stripeCustomerId,
        items: [
          {
            price: createPaymentIntent.yearlySubscription
              ? yearlyPriceId
              : monthlyPriceId,
            quantity: +createPaymentIntent.cardSlots,
          },
        ],
        payment_behavior: 'default_incomplete',
        expand: ['latest_invoice.payment_intent'],
      });
      const ephemeralKey = await this.stripe.ephemeralKeys.create(
        {
          customer: user.stripeCustomerId,
        },
        { apiVersion: '2020-08-27' },
      );

      return {
        subscriptionId: subscription.id,
        paymentIntent: subscription.latest_invoice,
        ephemeralKey,
      };
    } catch (error) {
      console.log(error);
      throw new BadRequestException(
        'Error creating subscription',
        error.message,
      );
    }
  }

  async setCardToDefault(data: any) {
    try {
      const subscription_id = data['subscription'];
      const payment_intent_id = data['payment_intent'];

      const payment_intent = await this.stripe.paymentIntents.retrieve(
        payment_intent_id,
      );
      return await this.stripe.subscriptions.update(subscription_id, {
        default_payment_method: payment_intent['payment_method'] as string,
      });
    } catch (error) {
      throw new BadRequestException(
        'Error setting default card',
        error.message,
      );
    }
  }

  async createBillingPortal(user: Users) {
    try {
      return await this.stripe.billingPortal.sessions.create({
        customer: user.stripeCustomerId,
        return_url: `${process.env.FRONTEND_URL}/`,
      });
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  ////////////////////////////////
  //                            //
  //      Private Methods       //
  //                            //
  ////////////////////////////////
  private async listSubscriptions(priceId: string, stripeCustomerId: string) {
    try {
      return this.stripe.subscriptions.list({
        customer: stripeCustomerId,
        price: priceId,
        expand: ['data.latest_invoice', 'data.latest_invoice.payment_intent'],
      });
    } catch (error) {
      throw new BadRequestException(
        'error listing subscription',
        error.message,
      );
    }
  }

  private async newMonthlySubscriptionStatus(
    customerId: string,
    data: any,
    monthlySubscriptionStatus: string,
  ) {
    return await this.prisma.users.update({
      where: {
        stripeCustomerId: customerId,
      },
      data: {
        monthlySubscriptionStatus,
        subscriptionId: data.id,
      },
    });
  }

  private async updateMonthlySubscriptionStatus(
    customerId: string,
    monthlySubscriptionStatus: string,
  ) {
    console.log(customerId);
    console.log(monthlySubscriptionStatus);

    return await this.prisma.users.update({
      where: { stripeCustomerId: customerId },
      data: { monthlySubscriptionStatus },
    });
  }

  private async updateCardSlotsCount(customerId: string, cardSlots: number) {
    try {
      const user = await this.prisma.users.findUnique({
        where: {
          stripeCustomerId: customerId,
        },
      });
      const newCardCount = cardSlots - user.cardSlots;
      await this.prisma.users.update({
        where: { email: user.email },
        data: {
          availableCardSlots: cardSlots
            ? user.availableCardSlots + newCardCount
            : user.availableCardSlots,
          cardSlots: cardSlots ? user.cardSlots + newCardCount : user.cardSlots,
        },
      });
      return;
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }
}
