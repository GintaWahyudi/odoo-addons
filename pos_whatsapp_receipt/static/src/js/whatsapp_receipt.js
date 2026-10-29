/** @odoo-module */

import { _t } from "@web/core/l10n/translation";
import { patch } from "@web/core/utils/patch";
import { ReceiptScreen } from "@point_of_sale/app/screens/receipt_screen/receipt_screen";
import { TextInputPopup } from "@point_of_sale/app/utils/input_popups/text_input_popup";
import { ErrorPopup } from "@point_of_sale/app/errors/popups/error_popup";

/**
 * Normalisasi nomor HP ke format internasional untuk wa.me.
 * Default negara: Indonesia (62).
 *  - "0812 3456 7890"  -> "6281234567890"
 *  - "+62 812-3456"    -> "628123456"
 *  - "6281234567890"   -> "6281234567890"
 *  - "81234567890"     -> "6281234567890" (anggap lokal ID)
 */
export function normalizeWhatsAppNumber(phone, defaultCountryCode = "62") {
    if (!phone) {
        return null;
    }
    let digits = String(phone).replace(/\D/g, "");
    if (!digits) {
        return null;
    }
    // "00" prefix internasional -> buang
    if (digits.startsWith("00")) {
        digits = digits.slice(2);
    }
    if (digits.startsWith("0")) {
        digits = defaultCountryCode + digits.slice(1);
    } else if (digits.startsWith(defaultCountryCode)) {
        // sudah internasional
    } else {
        digits = defaultCountryCode + digits;
    }
    return digits.length >= 8 ? digits : null;
}

/**
 * Bangun nota plain-text dari data export_for_printing().
 * Dibungkus ``` agar WhatsApp render monospace.
 */
export function buildWhatsAppReceiptText(order, env) {
    const data = order.export_for_printing();
    const partner = order.get_partner();
    const fmt = (v) => env.utils.formatCurrency(v);
    const W = 40;
    const line = (left, right = "") => {
        left = String(left);
        right = String(right);
        if (!right) {
            return left;
        }
        const space = W - left.length - right.length;
        return space > 0 ? left + " ".repeat(space) + right : left + " " + right;
    };
    const sep = "-".repeat(W);
    const center = (s) => {
        s = String(s || "");
        const pad = Math.max(0, Math.floor((W - s.length) / 2));
        return " ".repeat(pad) + s;
    };

    const out = [];
    const company = (data.headerData && data.headerData.company) || {};
    const headerText = (data.headerData && data.headerData.header) || "";

    out.push(center(`*${company.name || ""}*`).trimEnd());
    const addrLines = [
        company.street,
        company.street2,
        [company.city, company.state_id && company.state_id[1], company.zip]
            .filter(Boolean)
            .join(" "),
        company.country_id && company.country_id[1],
        company.phone ? `Telp: ${company.phone}` : null,
        company.vat ? `NPWP: ${company.vat}` : null,
    ].filter(Boolean);
    addrLines.forEach((l) => out.push(center(l)));
    if (headerText) {
        String(headerText)
            .split("\n")
            .forEach((l) => out.push(center(l)));
    }
    out.push(sep);
    out.push(line(data.name));
    out.push(line(`Tgl: ${data.date}`));
    if (data.cashier) {
        out.push(line(`Kasir: ${data.cashier}`));
    }
    if (partner && partner.name) {
        out.push(line(`Customer: ${partner.name}`));
    }
    out.push(sep);

    for (const l of data.orderlines) {
        if (l.comboParent) {
            continue;
        }
        out.push(line(l.productName));
        out.push(line(`  ${l.qty} x ${l.unitPrice}`, l.price));
        if (l.discount && l.discount !== "0") {
            out.push(line(`  Disc. ${l.discount}%`));
        }
    }
    out.push(sep);
    if (data.total_discount) {
        out.push(line("Diskon", fmt(data.total_discount)));
    }
    out.push(line("TOTAL", `*${fmt(data.amount_total)}*`));
    for (const p of data.paymentlines) {
        out.push(line(p.name, fmt(p.amount)));
    }
    if (data.change) {
        out.push(line("Kembali", fmt(data.change)));
    }
    out.push(sep);
    if (data.footer) {
        String(data.footer)
            .split("\n")
            .forEach((l) => out.push(center(l)));
    }
    out.push(center("Terima kasih!"));
    return "```\n" + out.join("\n") + "\n```";
}

patch(ReceiptScreen.prototype, {
    async onSendWhatsApp() {
        const order = this.currentOrder;
        const partner = order.get_partner();
        let phone = (partner && (partner.mobile || partner.phone)) || "";

        if (!phone) {
            const { confirmed, payload } = await this.env.services.popup.add(
                TextInputPopup,
                {
                    title: _t("Nomor WhatsApp Customer"),
                    body: _t(
                        "Customer belum punya nomor HP. Masukkan nomor WhatsApp tujuan:"
                    ),
                    placeholder: "08xxxxxxxxxx",
                    confirmText: _t("Kirim"),
                }
            );
            if (!confirmed) {
                return;
            }
            phone = payload;
        }

        const number = normalizeWhatsAppNumber(phone);
        if (!number) {
            await this.env.services.popup.add(ErrorPopup, {
                title: _t("Nomor tidak valid"),
                body: _t(
                    "Nomor '%s' tidak valid untuk WhatsApp. Gunakan format 08xx atau 62xx."
                ).replace("%s", phone),
            });
            return;
        }

        const text = buildWhatsAppReceiptText(order, this.env);
        const url = `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
        window.open(url, "_blank");
    },
});
