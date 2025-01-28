import { EGS, EGSUnitInfo } from "../zatca/egs";
import { ZATCASimplifiedInvoiceLineItem } from "../zatca/templates/simplified_tax_invoice_template";
import { ZATCASimplifiedTaxInvoice } from "../zatca/ZATCASimplifiedTaxInvoice";
import { generatePhaseOneQR } from "../zatca/qr";
import { writeFileSync } from 'fs';

// Sample line item
const line_item: ZATCASimplifiedInvoiceLineItem = {
    id: "1",
    name: "TEST NAME",
    quantity: 1,
    price: 20,
    tax: 2.6,
    total_price: 20 * 1,
    total_tax: 2.6,
    VAT_percent: 0.15,
    other_taxes: [], // emptied other taxes to comply with Zatca BR-KSA-84
    discounts: [
    ]
};

// Sample EGSUnit
const egsunit: EGSUnitInfo = {
    uuid: "6f4d20e0-6bfe-4a80-9389-7dabe6620f12",
    custom_id: "EGS1-886431145",
    model: "IOS",
    CRN_number: "1010010000",
    VAT_name: "ABC Company",
    VAT_number: "399999999900003",
    location: {
        city: "city",
        city_subdivision: "32423423",
        street: "street",
        plot_identification: "4323",
        building: "1545",
        postal_zone: "11417"
    },
    branch_name: "My Branch Name",
    branch_industry: "Food"
};

// Sample Invoice
const invoice = new ZATCASimplifiedTaxInvoice({
    props: {
        egs_info: egsunit,
        allowance_total: 10,
        total_exl_amount: 500 - 65.2,
        total_tax: 65.2,
        total_inclusive_amount: 500,
        invoice_counter_number: 1,
        invoice_serial_number: "EGS1-886431145-1",
        issue_date: "2022-03-13",
        issue_time: "14:40:40",
        buyer_name: "Naveed Baloch",
        previous_invoice_hash: "NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==",
        line_items: [
            {
                id: "1",
                name: "item1",
                quantity: 10,
                price: 25,
                tax: 3.26,
                total_price: 25 * 10,
                total_tax: 3.26 * 10,
                VAT_percent: 0.15,
                other_taxes: [], // emptied other taxes to comply with Zatca BR-KSA-84
                discounts: []
            },
            {
                id: "2",
                name: "item2",
                quantity: 10,
                price: 25,
                tax: 3.26,
                total_price: 25 * 10,
                total_tax: 3.26 * 10,
                VAT_percent: 0.15,
                other_taxes: [], // emptied other taxes to comply with Zatca BR-KSA-84
                discounts: [
                ]
            },
            {
                id: "1",
                name: "Delivery charges",
                quantity: 1,
                price: 20,
                tax: (20 * 0.15),
                total_price: 20,
                total_tax: (20 * 0.15),
                VAT_percent: 0.15,
                other_taxes: [], // emptied other taxes to comply with Zatca BR-KSA-84
                discounts: [
                ]
            }
        ]
    }
});


const main = async () => {
    try {

        // TEMP_FOLDER: Use .env or set directly here (Default: /tmp/)
        // Enable for windows
        // process.env.TEMP_FOLDER = `${require("os").tmpdir()}\\`;

        // Init a new EGS
        const egs = new EGS(egsunit);

        // New Keys & CSR for the EGS
        await egs.generateNewKeysAndCSR(false, "solution_name");

        // Issue a new compliance cert for the EGS
        const compliance_request_id = await egs.issueComplianceCertificate("123345");

        // Sign invoice
        const { signed_invoice_string, invoice_hash, qr } = egs.signInvoice(invoice);
        writeFileSync('invoice.xml', signed_invoice_string);
        // Check invoice compliance
        await egs.checkInvoiceCompliance(signed_invoice_string, invoice_hash)

        // Issue production certificate
        const production_request_id = await egs.issueProductionCertificate(compliance_request_id);

        //  // Report invoice production
        //  // Note: This request currently fails because ZATCA sandbox returns a constant fake production certificate
        let reportedInvoice = await egs.reportInvoice(signed_invoice_string, invoice_hash);
        console.log("Reporting Status: ", reportedInvoice?.reportingStatus);
    } catch (error: any) {
        console.log(JSON.stringify(error?.response?.data || { message: error.message }, null, 2));
    }
}


main();