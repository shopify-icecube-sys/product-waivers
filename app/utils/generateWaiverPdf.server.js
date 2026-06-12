import PDFDocument from "pdfkit";

export function generateWaiverPdf(submission) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50, bufferPages: true });

    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end",  ()  => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const PW      = doc.page.width;   // 595
    const MARGIN  = 50;
    const CONTENT = PW - MARGIN * 2;  // 495

    /* ─── Header Banner ─── */
    doc.rect(0, 0, PW, 64).fill("#1a1a1a");
    doc
      .fillColor("#ffffff")
      .font("Helvetica-Bold")
      .fontSize(14)
      .text("Competition / Racing Use Verification Form", MARGIN, 16, {
        width: CONTENT, align: "center",
      });
    doc
      .fillColor("#bbbbbb")
      .font("Helvetica")
      .fontSize(9)
      .text("Product Waivers — Official Submission Record", MARGIN, 36, {
        width: CONTENT, align: "center",
      });

    doc.y = 80;

    /* ─── Helpers ─── */

    // Section heading: bold text + full-width rule below
    function section(title) {
      if (doc.y > doc.page.height - 120) { doc.addPage(); doc.y = 50; }
      doc.moveDown(0.5);
      doc
        .font("Helvetica-Bold")
        .fontSize(9)
        .fillColor("#333333")
        .text(title, MARGIN, doc.y, { width: CONTENT });
      const lineY = doc.y + 2;
      doc.moveTo(MARGIN, lineY).lineTo(MARGIN + CONTENT, lineY).lineWidth(0.5).strokeColor("#333333").stroke();
      doc.y = lineY + 8;
    }

    // Single labeled field (full width)
    function fieldFull(label, value) {
      const startY = doc.y;
      doc
        .font("Helvetica-Bold")
        .fontSize(7.5)
        .fillColor("#666666")
        .text(label.toUpperCase(), MARGIN, startY, { width: CONTENT });
      doc
        .font("Helvetica")
        .fontSize(10)
        .fillColor("#111111")
        .text(value || "—", MARGIN, doc.y + 1, { width: CONTENT });
      doc.y += 12;
    }

    // Two fields side by side
    const COL = (CONTENT - 20) / 2;
    function fieldRow(l1, v1, l2, v2) {
      const startY = doc.y;
      const x2 = MARGIN + COL + 20;

      // Left label
      doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#666666")
         .text(l1.toUpperCase(), MARGIN, startY, { width: COL, lineBreak: false });
      // Right label
      doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#666666")
         .text(l2.toUpperCase(), x2, startY, { width: COL, lineBreak: false });

      const valY = startY + 11;
      // Left value
      doc.font("Helvetica").fontSize(10).fillColor("#111111")
         .text(v1 || "—", MARGIN, valY, { width: COL, lineBreak: false });
      // Right value
      doc.font("Helvetica").fontSize(10).fillColor("#111111")
         .text(v2 || "—", x2, valY, { width: COL, lineBreak: false });

      doc.y = valY + 14;
    }

    // Compliance row: label on left, YES/NO on right
    function complianceRow(label, val) {
      const startY = doc.y;
      const answer = val === "yes" ? "YES" : val === "no" ? "NO" : "—";
      const answerX = MARGIN + CONTENT - 30;

      doc.font("Helvetica").fontSize(9).fillColor("#111111")
         .text("• " + label, MARGIN, startY, { width: CONTENT - 40, lineBreak: false });
      doc.font("Helvetica-Bold").fontSize(9).fillColor("#111111")
         .text(answer, answerX, startY, { width: 30, align: "right", lineBreak: false });

      doc.y = startY + 14;
    }

    /* ─── CUSTOMER INFORMATION ─── */
    section("CUSTOMER INFORMATION");
    fieldRow("Full Legal Name", submission.fullName, "Email", submission.email);
    fieldRow("Phone", submission.phone, "Driver's License", submission.driversLicense);
    fieldFull("Street Address", submission.streetAddress);
    fieldRow("City", submission.city, "State", submission.state);
    fieldRow("ZIP", submission.zip, "Race Club / League", submission.raceClub || "—");
    if (submission.ipAddress) {
      fieldFull("IP Address", submission.ipAddress);
    }

    /* ─── VEHICLE INFORMATION ─── */
    section("VEHICLE INFORMATION");
    fieldRow("Year", submission.vehicleYear, "Make", submission.vehicleMake);
    fieldRow("Model", submission.vehicleModel, "Color", submission.vehicleColor);
    fieldFull("VIN", submission.vin);
    fieldRow("DMV Registered", submission.dmvRegistered || "—", "Licensed for Road Use", submission.licensedForRoad || "—");

    /* ─── COMPLIANCE ─── */
    section("COMPLIANCE ACKNOWLEDGEMENTS");
    complianceRow("Product is for racing / off-road use only",       submission.racingUseOnly);
    complianceRow("Vehicle is NOT operated on public roads",         submission.notOnPublicRoads);
    complianceRow("Acknowledges product is NOT CARB approved",       submission.notCarbApproved);
    complianceRow("Acknowledges product is NOT EPA certified",       submission.notEpaCertified);

    /* ─── SIGNATURE & CERTIFICATION ─── */
    section("SIGNATURE & CERTIFICATION");
    fieldRow("Printed Name", submission.printedName, "Date Signed", submission.signatureDate);
    doc.moveDown(0.2);
    complianceRow("Understands product is not CARB approved",                      submission.certCarbApproved);
    complianceRow("Understands product may not be EPA certified",                  submission.certEpaCertified);
    complianceRow("Certifies racing/off-road use only (under penalty of perjury)", submission.certPerjury);

    /* Digital signature image */
    if (submission.digitalSignature?.startsWith("data:")) {
      doc.moveDown(0.3);
      doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#666666")
         .text("DIGITAL SIGNATURE", MARGIN, doc.y);
      doc.y += 4;
      doc.rect(MARGIN, doc.y, 220, 65).lineWidth(0.5).strokeColor("#aaaaaa").stroke();
      try {
        const imgBuf = Buffer.from(submission.digitalSignature.split(",")[1], "base64");
        doc.image(imgBuf, MARGIN + 4, doc.y + 4, { width: 212, height: 57 });
        doc.y += 72;
      } catch {
        doc.font("Helvetica").fontSize(9).fillColor("#888888")
           .text("[Signature on file]", MARGIN + 8, doc.y + 24);
        doc.y += 72;
      }
    }

    /* ─── Footer on every page ─── */
    const footerText =
      `Order: ${submission.orderNumber || "—"}  •  ID: ${submission.id}  •  Shop: ${submission.shop}` +
      `  •  Product: ${submission.productHandle}  •  Submitted: ${new Date(submission.createdAt).toLocaleString()}`;

    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      const fY = doc.page.height - 30;
      doc.moveTo(MARGIN, fY - 6).lineTo(MARGIN + CONTENT, fY - 6).lineWidth(0.5).strokeColor("#cccccc").stroke();
      doc.font("Helvetica").fontSize(6.5).fillColor("#888888")
         .text(footerText, MARGIN, fY, { width: CONTENT, align: "center" });
    }

    doc.end();
  });
}
