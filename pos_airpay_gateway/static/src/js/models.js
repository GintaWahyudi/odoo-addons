/** @odoo-module */
import { register_payment_method } from "@point_of_sale/app/store/pos_store";
import { PaymentAirPay } from "@pos_airpay_gateway/js/payment_airpay";

register_payment_method("airpay", PaymentAirPay);
