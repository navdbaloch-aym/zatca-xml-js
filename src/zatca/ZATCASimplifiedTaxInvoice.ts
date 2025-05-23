import { XMLDocument } from "../parser";
import { generateSignedXMLString } from "./signing";
import defaultSimplifiedTaxInvoice, {
    ZATCASimplifiedInvoiceLineItem,
    ZATCASimplifiedInvoiceProps,
    ZATCAInvoiceTypes,
    ZATCAPaymentMethods
} from "./templates/simplified_tax_invoice_template";

declare global {
    interface Number {
        toFixedNoRounding: (n: number) => string;
    }
}

Number.prototype.toFixedNoRounding = function (n: number) {
    const reg = new RegExp("^-?\\d+(?:\\.\\d{0," + n + "})?", "g")
    let m = this.toString().match(reg);
    if (m?.length) {
        const a = m[0];
        const dot = a.indexOf(".");
        if (dot === -1) {
            return a + "." + "0".repeat(n);
        }
        const b = n - (a.length - dot) + 1;
        return b > 0 ? (a + "0".repeat(b)) : a;
    }
    return "0.00";
}

export { ZATCASimplifiedInvoiceLineItem, ZATCASimplifiedInvoiceProps, ZATCAInvoiceTypes, ZATCAPaymentMethods };
export class ZATCASimplifiedTaxInvoice {

    private invoice_xml: XMLDocument;

    /**
     * Parses a ZATCA Simplified Tax Invoice XML string. Or creates a new one based on given props.
     * @param invoice_xml_str Invoice XML string to parse.
     * @param props ZATCASimplifiedInvoiceProps props to create a new unsigned invoice.
     */
    constructor({ invoice_xml_str, props }: { invoice_xml_str?: string, props?: ZATCASimplifiedInvoiceProps }) {

        if (invoice_xml_str) {
            this.invoice_xml = new XMLDocument(invoice_xml_str);
            if (!this.invoice_xml) throw new Error("Error parsing invoice XML string.");
        } else {
            if (!props) throw new Error("Unable to create new XML invoice.");
            this.invoice_xml = new XMLDocument(defaultSimplifiedTaxInvoice(props));

            // Parsing
            this.parseLineItems(props.line_items ?? [], props);

        }
    }

    private constructLineItemTotals = (line_item: ZATCASimplifiedInvoiceLineItem) => {
        let line_item_total_discounts = 0;
        let line_item_total_taxes = line_item.total_tax;

        let cacAllowanceCharges: any[] = [];

        let cacClassifiedTaxCategories: any[] = [];
        let cacTaxTotal = {};

        // VAT
        // BR-KSA-DEC-02
        const VAT = {
            "cbc:ID": line_item.VAT_percent ? "S" : "O",
            // BT-120, KSA-121
            "cbc:Percent": line_item.VAT_percent ? (line_item.VAT_percent * 100).toFixedNoRounding(2) : undefined,
            "cac:TaxScheme": {
                "cbc:ID": "VAT"
            }
        };
        cacClassifiedTaxCategories.push(VAT);

        // Calc total discounts
        line_item.discounts?.map((discount) => {
            line_item_total_discounts += discount.amount;
            cacAllowanceCharges.push({
                "cbc:ChargeIndicator": "false",
                "cbc:AllowanceChargeReason": discount.reason,
                "cbc:Amount": {
                    "@_currencyID": "SAR",
                    // BR-DEC-01
                    "#text": discount.amount.toFixedNoRounding(2)
                }
            });
        });


        // Calc item subtotal
        let line_item_subtotal =
            line_item.total_price - line_item.total_tax - line_item_total_discounts;

        // Calc total taxes
        // BR-KSA-DEC-02
        line_item.other_taxes?.map((tax) => {
            line_item_total_taxes = parseFloat(line_item_total_taxes.toFixedNoRounding(2)) + parseFloat((tax.percent_amount * line_item_subtotal).toFixedNoRounding(2));
            line_item_total_taxes = parseFloat(line_item_total_taxes.toFixedNoRounding(2));
            cacClassifiedTaxCategories.push({
                "cbc:ID": "S",
                "cbc:Percent": (tax.percent_amount * 100).toFixedNoRounding(2),
                "cac:TaxScheme": {
                    "cbc:ID": "VAT"
                }
            })
        });

        // BR-KSA-DEC-03, BR-KSA-51
        cacTaxTotal = {
            "cbc:TaxAmount": {
                "@_currencyID": "SAR",
                "#text": line_item_total_taxes.toFixed(2)
            },
            "cbc:RoundingAmount": {
                "@_currencyID": "SAR",
                "#text": line_item.total_price.toFixed(2)
            }
        };


        return {
            cacAllowanceCharges,
            cacClassifiedTaxCategories, cacTaxTotal,
            line_item_total_tax_exclusive: line_item_subtotal,
            line_item_total_taxes,
            line_item_total_discounts
        }
    }


    private constructLineItem = (line_item: ZATCASimplifiedInvoiceLineItem) => {

        const {
            cacAllowanceCharges,
            cacClassifiedTaxCategories, cacTaxTotal,
            line_item_total_tax_exclusive,
            line_item_total_taxes,
            line_item_total_discounts
        } = this.constructLineItemTotals(line_item);

        return {
            line_item_xml: {
                "cbc:ID": line_item.id,
                "cbc:InvoicedQuantity": {
                    "@_unitCode": "PCE",
                    "#text": line_item.quantity
                },
                // BR-DEC-23
                "cbc:LineExtensionAmount": {
                    "@_currencyID": "SAR",
                    "#text": line_item_total_tax_exclusive.toFixedNoRounding(2)
                },
                "cac:AllowanceCharge": cacAllowanceCharges,
                "cac:TaxTotal": cacTaxTotal,
                "cac:Item": {
                    "cbc:Name": line_item.name,
                    "cac:ClassifiedTaxCategory": cacClassifiedTaxCategories
                },
                "cac:Price": {
                    "cbc:PriceAmount": {
                        "@_currencyID": "SAR",
                        "#text": (line_item.price - line_item.tax).toFixed(2)
                    },

                }
            },
            line_item_totals: {
                taxes_total: line_item_total_taxes,
                discounts_total: line_item_total_discounts,
                subtotal: line_item_total_tax_exclusive
            }
        };
    }


    private constructLegalMonetaryTotal = (tax_inclusive_subtotal: number, taxes_total: number, allowances_total: number, charges_total: number) => {
        const tax_exl_amount = (tax_inclusive_subtotal - taxes_total).toFixed(2);
        return {
            // BR-DEC-09
            "cbc:LineExtensionAmount": {
                "@_currencyID": "SAR",
                "#text": tax_exl_amount
            },
            // BR-DEC-12
            "cbc:TaxExclusiveAmount": {
                "@_currencyID": "SAR",
                "#text": tax_exl_amount
            },
            // BR-DEC-14, BT-112
            "cbc:TaxInclusiveAmount": {
                "@_currencyID": "SAR",
                "#text": tax_inclusive_subtotal.toFixed(2)
            },
            "cbc:AllowanceTotalAmount": {
                "@_currencyID": "SAR",
                "#text": allowances_total
            },
            "cbc:ChargeTotalAmount": {
                "@_currencyID": "SAR",
                "#text": charges_total
            },
            "cbc:PrepaidAmount": {
                "@_currencyID": "SAR",
                "#text": 0
            },
            // BR-DEC-18, BT-112
            "cbc:PayableAmount": {
                "@_currencyID": "SAR",
                "#text": tax_inclusive_subtotal.toFixedNoRounding(2)
            }
        }
    }

    private constructTaxTotal = (line_items: ZATCASimplifiedInvoiceLineItem[], props: ZATCASimplifiedInvoiceProps) => {

        const cacTaxSubtotal: any[] = [];
        // BR-DEC-13, MESSAGE : [BR-DEC-13]-The allowed maximum number of decimals for the Invoice total VAT amount (BT-110) is 2.
        const addTaxSubtotal = (tax_incl_amt: number, tax_amount: number, tax_percent: number) => {
            cacTaxSubtotal.push({
                // BR-DEC-19
                "cbc:TaxableAmount": {
                    "@_currencyID": "SAR",
                    "#text": (tax_incl_amt-tax_amount).toFixedNoRounding(2)
                },
                "cbc:TaxAmount": {
                    "@_currencyID": "SAR",
                    "#text": tax_amount.toFixed(2)
                },
                "cac:TaxCategory": {
                    "cbc:ID": {
                        "@_schemeAgencyID": 6,
                        "@_schemeID": "UN/ECE 5305",
                        "#text": tax_percent ? "S" : "O"
                    },
                    "cbc:Percent": (tax_percent * 100).toFixedNoRounding(2),
                    // BR-O-10
                    "cbc:TaxExemptionReason": tax_percent ? undefined : "Not subject to VAT",
                    "cac:TaxScheme": {
                        "cbc:ID": {
                            "@_schemeAgencyID": "6",
                            "@_schemeID": "UN/ECE 5153",
                            "#text": "VAT"
                        }
                    },
                }
            });
        }

        let taxes_total = props.total_tax;
        line_items.map((line_item) => {
            const total_line_item_discount = line_item.discounts?.reduce((p, c) => p + c.amount, 0);
            const taxable_amount = line_item.total_price - (total_line_item_discount ?? 0);
            line_item.other_taxes?.map((tax) => {
                let tax_amount = tax.percent_amount * taxable_amount;
                taxes_total += parseFloat(tax_amount.toFixedNoRounding(2));
            });
        });
        const tax_percentage = line_items.map(li => li.VAT_percent).sort((a, b) => b - a)[0];
        addTaxSubtotal(props.total_inclusive_amount, taxes_total, tax_percentage);


        // BR-DEC-13, MESSAGE : [BR-DEC-13]-The allowed maximum number of decimals for the Invoice total VAT amount (BT-110) is 2.
        return [
            {
                // Total tax amount for the full invoice
                "cbc:TaxAmount": {
                    "@_currencyID": "SAR",
                    "#text": taxes_total.toFixed(2)
                },
                "cac:TaxSubtotal": cacTaxSubtotal,
            },
            {
                // KSA Rule for VAT tax
                "cbc:TaxAmount": {
                    "@_currencyID": "SAR",
                    "#text": taxes_total.toFixed(2)
                }
            }
        ];
    }

    private parseLineItems(line_items: ZATCASimplifiedInvoiceLineItem[], props: ZATCASimplifiedInvoiceProps) {

        let total_taxes: number = props.total_tax;
        let total_inclusive_amount: number = props.total_inclusive_amount;
        let line_total_allowances: number = 0;

        let invoice_line_items: any[] = [];
        line_items.map((line_item) => {
            const { line_item_xml } = this.constructLineItem(line_item);
            const discountTotal = line_item.discounts?.reduce((pVal, cVal) => pVal + cVal.amount, 0) || 0;
            line_total_allowances += parseFloat(discountTotal.toFixedNoRounding(2));
            invoice_line_items.push(line_item_xml);
        });

        // BT-110
        total_inclusive_amount = parseFloat(total_inclusive_amount.toFixedNoRounding(2))
        line_total_allowances = parseFloat(line_total_allowances.toFixedNoRounding(2))

        if (props.cancelation) {
            // Invoice canceled. Tunred into credit/debit note. Must have PaymentMeans
            // BR-KSA-17
            this.invoice_xml.set("Invoice/cac:PaymentMeans", false, {
                "cbc:PaymentMeansCode": props.cancelation.payment_method,
                "cbc:InstructionNote": props.cancelation.reason ?? "No note Specified"
            });
        } else if (props.payment_method) {
            this.invoice_xml.set("Invoice/cac:PaymentMeans", false, {
                "cbc:PaymentMeansCode": props.payment_method,
            });
        }

        if (props.allowance_total) {
            this.invoice_xml.set("Invoice/cac:AllowanceCharge", false, {
                "cbc:ChargeIndicator": false,
                "cbc:AllowanceChargeReason": 'discount',
                "cbc:Amount": {
                    "@_currencyID": "SAR",
                    // BR-DEC-01
                    "#text": props.allowance_total.toFixedNoRounding(2)
                },
                "cac:TaxCategory": {
                    "cbc:ID": "S",
                    "cbc:Percent": 15,
                    "cac:TaxScheme": {
                        "cbc:ID": "VAT"
                    }
                }
            });
        }

        if (props.delivery_charges) {
            this.invoice_xml.set("Invoice/cac:AllowanceCharge", false, {
                "cbc:ChargeIndicator": true,
                "cbc:AllowanceChargeReason": 'Delivery Charges',
                "cbc:Amount": {
                    "@_currencyID": "SAR",
                    // BR-DEC-01
                    "#text": props.delivery_charges.toFixedNoRounding(2)
                }
            });
        }

        this.invoice_xml.set("Invoice/cac:TaxTotal", false, this.constructTaxTotal(line_items, props));

        this.invoice_xml.set("Invoice/cac:LegalMonetaryTotal", true, this.constructLegalMonetaryTotal(
            total_inclusive_amount,
            total_taxes,
            line_total_allowances + (props.allowance_total ?? 0),
            (props.delivery_charges ?? 0)
        ));



        invoice_line_items.map((line_item) => {
            this.invoice_xml.set("Invoice/cac:InvoiceLine", false, line_item);
        });

    }

    getXML(): XMLDocument {
        return this.invoice_xml;
    }

    /**
     * Signs the invoice.
     * @param certificate_string String signed EC certificate.
     * @param private_key_string String ec-secp256k1 private key;
     * @returns String signed invoice xml, includes QR generation.
     */
    sign(certificate_string: string, private_key_string: string) {
        return generateSignedXMLString({
            invoice_xml: this.invoice_xml,
            certificate_string: certificate_string,
            private_key_string: private_key_string
        });
    }

}

