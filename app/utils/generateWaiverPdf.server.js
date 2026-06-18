import PDFDocument from "pdfkit";

export function generateWaiverPdf(submission) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margins: { top: 50, left: 50, right: 50, bottom: 20 },
      bufferPages: true,
    });

    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end",  ()  => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const PW      = doc.page.width;   // 595
    const MARGIN  = 50;
    const CONTENT = PW - MARGIN * 2;  // 495

    /* ─── Header Banner ─── */
    function drawHeader() {
      doc.rect(0, 0, PW, 72).fill("#1a1a1a");
      doc
        .fillColor("#ffffff")
        .font("Helvetica-Bold")
        .fontSize(15)
        .text("Competition / Racing Use Verification Form", MARGIN, 18, {
          width: CONTENT, align: "center",
        });
      doc
        .fillColor("#bbbbbb")
        .font("Helvetica")
        .fontSize(9.5)
        .text("Product Waivers — Official Submission Record", MARGIN, 40, {
          width: CONTENT, align: "center",
        });
    }

    drawHeader();
    doc.y = 90;

    /* ─── Helpers ─── */

    function section(title) {
      doc.moveDown(0.8);
      doc
        .font("Helvetica-Bold")
        .fontSize(10)
        .fillColor("#1a1a1a")
        .text(title, MARGIN, doc.y, { width: CONTENT });
      const lineY = doc.y + 3;
      doc.moveTo(MARGIN, lineY).lineTo(MARGIN + CONTENT, lineY).lineWidth(0.75).strokeColor("#1a1a1a").stroke();
      doc.y = lineY + 12;
    }

    function fieldFull(label, value) {
      const startY = doc.y;
      doc
        .font("Helvetica-Bold")
        .fontSize(8)
        .fillColor("#888888")
        .text(label.toUpperCase(), MARGIN, startY, { width: CONTENT });
      doc
        .font("Helvetica")
        .fontSize(11)
        .fillColor("#111111")
        .text(value || "—", MARGIN, doc.y + 2, { width: CONTENT });
      doc.y += 16;
    }

    const COL = (CONTENT - 24) / 2;
    function fieldRow(l1, v1, l2, v2) {
      const startY = doc.y;
      const x2 = MARGIN + COL + 24;

      doc.font("Helvetica-Bold").fontSize(8).fillColor("#888888")
         .text(l1.toUpperCase(), MARGIN, startY, { width: COL, lineBreak: false });
      doc.font("Helvetica-Bold").fontSize(8).fillColor("#888888")
         .text(l2.toUpperCase(), x2, startY, { width: COL, lineBreak: false });

      const valY = startY + 13;
      doc.font("Helvetica").fontSize(11).fillColor("#111111")
         .text(v1 || "—", MARGIN, valY, { width: COL, lineBreak: false });
      doc.font("Helvetica").fontSize(11).fillColor("#111111")
         .text(v2 || "—", x2, valY, { width: COL, lineBreak: false });

      doc.y = valY + 20;
    }

    function complianceRow(label, val) {
      const startY = doc.y;
      const answer = val === "yes" ? "YES" : val === "no" ? "NO" : "—";
      const answerColor = val === "yes" ? "#1a7a3c" : val === "no" ? "#c0392b" : "#888888";
      const answerX = MARGIN + CONTENT - 36;

      doc.font("Helvetica").fontSize(10).fillColor("#222222")
         .text("• " + label, MARGIN, startY, { width: CONTENT - 50, lineBreak: false });
      doc.font("Helvetica-Bold").fontSize(10).fillColor(answerColor)
         .text(answer, answerX, startY, { width: 36, align: "right", lineBreak: false });

      doc.y = startY + 20;
    }

    /* ─── PAGE 1: CUSTOMER + VEHICLE ─── */
    section("CUSTOMER INFORMATION");
    fieldRow("Full Legal Name", submission.fullName, "Email", submission.email);
    fieldRow("Phone", submission.phone, "Driver's License", submission.driversLicense);
    fieldFull("Street Address", submission.streetAddress);
    fieldRow("City", submission.city, "State", submission.state);
    fieldRow("ZIP", submission.zip, "Race Club / League", submission.raceClub || "—");
    if (submission.ipAddress) {
      fieldFull("IP Address", submission.ipAddress);
    }

    doc.moveDown(1.2);

    section("VEHICLE INFORMATION");
    fieldRow("Year", submission.vehicleYear, "Make", submission.vehicleMake);
    fieldRow("Model", submission.vehicleModel, "Color", submission.vehicleColor);
    fieldFull("VIN", submission.vin);
    fieldRow("DMV Registered", submission.dmvRegistered || "—", "Licensed for Road Use", submission.licensedForRoad || "—");

    /* ─── PAGE 2: COMPLIANCE + SIGNATURE ─── */
    doc.addPage();
    drawHeader();
    doc.y = 90;

    section("COMPLIANCE ACKNOWLEDGEMENTS");
    complianceRow("Product is for racing / off-road use only",       submission.racingUseOnly);
    complianceRow("Vehicle is NOT operated on public roads",         submission.notOnPublicRoads);
    complianceRow("Acknowledges product is NOT CARB approved",       submission.notCarbApproved);
    complianceRow("Acknowledges product is NOT EPA certified",       submission.notEpaCertified);

    doc.moveDown(1.2);

    section("SIGNATURE & CERTIFICATION");
    fieldRow("Printed Name", submission.printedName, "Date Signed", submission.signatureDate);
    doc.moveDown(0.5);
    complianceRow("Understands product is not CARB approved",                      submission.certCarbApproved);
    complianceRow("Understands product may not be EPA certified",                  submission.certEpaCertified);
    complianceRow("Certifies racing/off-road use only (under penalty of perjury)", submission.certPerjury);

    doc.moveDown(1.2);

    /* Digital signature image */
    if (submission.digitalSignature?.startsWith("data:")) {
      doc.font("Helvetica-Bold").fontSize(8).fillColor("#888888")
         .text("DIGITAL SIGNATURE", MARGIN, doc.y);
      doc.y += 8;
      doc.rect(MARGIN, doc.y, 260, 80).lineWidth(0.5).strokeColor("#aaaaaa").stroke();
      try {
        const imgBuf = Buffer.from(submission.digitalSignature.split(",")[1], "base64");
        doc.image(imgBuf, MARGIN + 5, doc.y + 5, { width: 250, height: 70 });
        doc.y += 88;
      } catch {
        doc.font("Helvetica").fontSize(9).fillColor("#888888")
           .text("[Signature on file]", MARGIN + 10, doc.y + 30);
        doc.y += 88;
      }
    }

    /* ─── Footer on every page ─── */
    const footerText =
      `Order: ${submission.orderNumber || "—"}  •  ID: ${submission.id}  •  Shop: ${submission.shop}` +
      `  •  Product: ${submission.productHandle}  •  Submitted: ${new Date(submission.createdAt).toLocaleString()}`;

    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      // Disable auto-page-break so footer text never creates an overflow page
      doc.page.margins.bottom = 0;
      const fY = doc.page.height - 32;
      doc.moveTo(MARGIN, fY - 8).lineTo(MARGIN + CONTENT, fY - 8).lineWidth(0.5).strokeColor("#dddddd").stroke();
      doc.font("Helvetica").fontSize(6.5).fillColor("#aaaaaa")
         .text(footerText, MARGIN, fY, { width: CONTENT, align: "center", lineBreak: false });
    }

    doc.end();
  });
}
