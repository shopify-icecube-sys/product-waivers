import { useState } from "react";
import { useLoaderData, useSubmit, useNavigate } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";

const PER_PAGE = 25;

const CSS = `
  .sub-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 16px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  }
  .sub-count {
    font-size: 13px; font-weight: 600; color: #374151;
    background: #f3f4f6; padding: 4px 14px; border-radius: 20px;
  }
  .sub-empty {
    text-align: center; padding: 64px 24px; color: #6b7280;
    font-size: 14px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: #f9fafb; border: 1px dashed #d1d5db; border-radius: 10px;
  }
  .sub-table-wrap {
    overflow-x: auto; border: 1px solid #e5e7eb;
    border-radius: 10px; box-shadow: 0 1px 3px rgba(0,0,0,0.05);
  }
  .sub-table {
    width: 100%; border-collapse: collapse;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 13px;
  }
  .sub-table th {
    background: #f9fafb; padding: 11px 14px; text-align: left;
    font-weight: 600; color: #374151; border-bottom: 1px solid #e5e7eb;
    white-space: nowrap; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em;
  }
  .sub-table td { padding: 11px 14px; border-bottom: 1px solid #f3f4f6; color: #111; vertical-align: middle; }
  .sub-row { cursor: pointer; transition: background 0.12s; }
  .sub-row:hover  { background: #f0f7ff; }
  .sub-row-open   { background: #eff6ff !important; }
  .sub-row:last-child td { border-bottom: none; }
  .sub-num { color: #9ca3af; font-weight: 700; width: 36px; }
  .sub-handle { font-size: 11px; font-family: monospace; background: #f3f4f6; padding: 2px 7px; border-radius: 4px; color: #374151; }
  .sub-vehicle { color: #374151; }
  .sub-toggle-btn {
    padding: 4px 12px; font-size: 12px; font-weight: 600;
    background: #2563eb; color: #fff; border: none; border-radius: 5px;
    cursor: pointer; white-space: nowrap; transition: background 0.15s;
  }
  .sub-toggle-btn:hover { background: #1d4ed8; }
  .sub-toggle-btn.open  { background: #64748b; }

  /* Expanded detail */
  .sub-detail-row td { padding: 0; background: #f8faff; border-bottom: 2px solid #2563eb; }
  .sub-detail { padding: 24px 28px; }
  .sub-sections { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
  .sub-section { background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px 18px; }
  .sub-section.wide { grid-column: 1 / -1; }
  .sub-section-title {
    font-size: 11px; font-weight: 700; color: #2563eb;
    text-transform: uppercase; letter-spacing: 0.06em;
    margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid #dbeafe;
  }
  .sub-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 10px; }
  .sub-item { display: flex; flex-direction: column; gap: 3px; }
  .sub-item.wide { grid-column: 1 / -1; }
  .sub-item .lbl { font-size: 10px; color: #9ca3af; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; }
  .sub-item .val { font-size: 13px; color: #111; font-weight: 500; }
  .yn-yes { color: #16a34a; font-weight: 700; }
  .yn-no  { color: #dc2626; font-weight: 700; }
  .sub-sig-wrap { margin-top: 12px; }
  .sub-sig-wrap .lbl { font-size: 10px; color: #9ca3af; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; display: block; margin-bottom: 6px; }
  .sub-sig-img { display: block; max-width: 320px; height: auto; border: 1px solid #e5e7eb; border-radius: 6px; background: #fff; padding: 4px; }
  .sub-meta { margin-top: 16px; padding-top: 12px; border-top: 1px solid #e5e7eb; font-size: 11px; color: #9ca3af; font-family: monospace; grid-column: 1 / -1; }
  .sub-meta code { background: #f3f4f6; padding: 1px 5px; border-radius: 3px; }

  /* Pagination */
  .sub-pagination {
    display: flex; align-items: center; justify-content: space-between;
    margin-top: 16px; padding: 12px 4px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 13px; color: #6b7280;
  }
  .sub-page-btns { display: flex; gap: 6px; align-items: center; }
  .sub-page-btn {
    padding: 5px 12px; border: 1px solid #d1d5db; border-radius: 6px;
    background: #fff; color: #374151; font-size: 13px; font-weight: 500;
    cursor: pointer; transition: background 0.12s, border-color 0.12s;
    font-family: inherit;
  }
  .sub-page-btn:hover:not(:disabled) { background: #f3f4f6; border-color: #9ca3af; }
  .sub-page-btn:disabled { opacity: 0.38; cursor: not-allowed; }
  .sub-page-btn.pg-active { background: #2563eb; color: #fff; border-color: #2563eb; font-weight: 700; }
  .sub-page-ellipsis { padding: 0 4px; color: #9ca3af; }

  /* Confirmation modal */
  .sub-modal-overlay {
    position: fixed; inset: 0; background: rgba(0,0,0,0.45);
    display: flex; align-items: center; justify-content: center; z-index: 99999;
    animation: sub-fade 0.15s ease;
  }
  .sub-modal-box {
    background: #fff; border-radius: 12px; padding: 28px 32px;
    max-width: 400px; width: 90%;
    box-shadow: 0 20px 60px rgba(0,0,0,0.18);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    animation: sub-pop 0.18s ease;
  }
  .sub-modal-icon { font-size: 28px; margin-bottom: 12px; }
  .sub-modal-title { font-size: 17px; font-weight: 700; color: #111; margin: 0 0 8px; }
  .sub-modal-body  { font-size: 14px; color: #6b7280; margin: 0 0 24px; line-height: 1.5; }
  .sub-modal-btns  { display: flex; gap: 10px; justify-content: flex-end; }
  .sub-modal-cancel {
    padding: 8px 18px; border: 1px solid #d1d5db; border-radius: 7px;
    background: #fff; color: #374151; font-size: 14px; font-weight: 500;
    cursor: pointer; font-family: inherit;
  }
  .sub-modal-cancel:hover { background: #f3f4f6; }
  .sub-modal-confirm {
    padding: 8px 18px; border: none; border-radius: 7px;
    background: #dc2626; color: #fff; font-size: 14px; font-weight: 600;
    cursor: pointer; font-family: inherit;
  }
  .sub-modal-confirm:hover { background: #b91c1c; }
  @keyframes sub-fade { from { opacity: 0; } to { opacity: 1; } }
  @keyframes sub-pop  { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }
`;

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  const url  = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));

  const [total, submissions] = await Promise.all([
    db.waiverSubmission.count(),
    db.waiverSubmission.findMany({
      orderBy: { createdAt: "desc" },
      skip:  (page - 1) * PER_PAGE,
      take:  PER_PAGE,
    }),
  ]);

  return { submissions, total, page };
};

export const action = async ({ request }) => {
  await authenticate.admin(request);
  const formData = await request.formData();
  if (formData.get("_action") === "clearAll") {
    await db.waiverSubmission.deleteMany({});
  }
  return { ok: true };
};

/* ── helpers ── */
function fmt(d) {
  return new Date(d).toLocaleString("en-US", {
    year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}
function dash(v) { return v || "—"; }

function YN({ v }) {
  if (v === "yes") return <span className="yn-yes">Yes</span>;
  if (v === "no")  return <span className="yn-no">No</span>;
  return <span>—</span>;
}

function Field({ label, value, wide }) {
  return (
    <div className={`sub-item${wide ? " wide" : ""}`}>
      <span className="lbl">{label}</span>
      <span className="val">{value ?? "—"}</span>
    </div>
  );
}

function DownloadBtn({ content, filename }) {
  if (!filename) return <span className="val">—</span>;
  const download = () => {
    if (!content) return;
    const a = document.createElement("a");
    a.href = content;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };
  return (
    <div className="sub-item">
      <span className="lbl">{filename}</span>
      {content ? (
        <button onClick={download} style={{ background: "none", border: "1px solid #2563eb", color: "#2563eb",
          borderRadius: "4px", padding: "3px 10px", fontSize: "12px",
          cursor: "pointer", fontWeight: 600, marginTop: "2px", width: "fit-content" }}>
          ⬇ Download PDF
        </button>
      ) : (
        <span style={{ fontSize: "11px", color: "#9ca3af", marginTop: "2px" }}>Not stored</span>
      )}
    </div>
  );
}

/* Custom confirmation modal — no browser alert */
function ConfirmModal({ count, onConfirm, onCancel }) {
  return (
    <div className="sub-modal-overlay" onClick={onCancel}>
      <div className="sub-modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="sub-modal-icon">🗑️</div>
        <p className="sub-modal-title">Clear all submissions?</p>
        <p className="sub-modal-body">
          This will permanently delete all <strong>{count}</strong> submission{count !== 1 ? "s" : ""}.
          This action cannot be undone.
        </p>
        <div className="sub-modal-btns">
          <button className="sub-modal-cancel" onClick={onCancel}>Cancel</button>
          <button className="sub-modal-confirm" onClick={onConfirm}>Yes, delete all</button>
        </div>
      </div>
    </div>
  );
}

function ClearAllButton({ count }) {
  const submit = useSubmit();
  const [showModal, setShowModal] = useState(false);

  const handleConfirm = () => {
    setShowModal(false);
    submit({ _action: "clearAll" }, { method: "post" });
  };

  return (
    <>
      <button
        onClick={() => setShowModal(true)}
        style={{ background: "#dc2626", color: "#fff", border: "none", borderRadius: "6px",
          padding: "7px 16px", fontSize: "13px", fontWeight: 600, cursor: "pointer" }}
      >
        🗑 Clear All Submissions
      </button>
      {showModal && (
        <ConfirmModal count={count} onConfirm={handleConfirm} onCancel={() => setShowModal(false)} />
      )}
    </>
  );
}

/* Pagination controls */
function Pagination({ page, total }) {
  const navigate   = useNavigate();
  const totalPages = Math.ceil(total / PER_PAGE);
  if (totalPages <= 1) return null;

  const from = (page - 1) * PER_PAGE + 1;
  const to   = Math.min(page * PER_PAGE, total);

  /* Build a compact page list: 1 … prev cur next … last */
  const pages = [];
  for (let p = 1; p <= totalPages; p++) {
    if (p === 1 || p === totalPages || Math.abs(p - page) <= 1) {
      pages.push(p);
    } else if (pages[pages.length - 1] !== "…") {
      pages.push("…");
    }
  }

  return (
    <div className="sub-pagination">
      <span>Showing {from}–{to} of {total} submissions</span>
      <div className="sub-page-btns">
        <button className="sub-page-btn" disabled={page <= 1}
          onClick={() => navigate(`?page=${page - 1}`)}>
          ← Prev
        </button>
        {pages.map((p, i) =>
          p === "…"
            ? <span key={`e${i}`} className="sub-page-ellipsis">…</span>
            : <button key={p} className={`sub-page-btn${p === page ? " pg-active" : ""}`}
                onClick={() => navigate(`?page=${p}`)}>
                {p}
              </button>
        )}
        <button className="sub-page-btn" disabled={page >= totalPages}
          onClick={() => navigate(`?page=${page + 1}`)}>
          Next →
        </button>
      </div>
    </div>
  );
}

function Detail({ s }) {
  return (
    <div className="sub-detail">
      <div className="sub-sections">
        <div className="sub-section">
          <div className="sub-section-title">Customer Information</div>
          <div className="sub-grid">
            <Field label="Full Legal Name"  value={s.fullName} />
            <Field label="Email"            value={s.email} />
            <Field label="Phone"            value={s.phone} />
            <Field label="Driver's License" value={s.driversLicense} />
            <Field label="Street Address"   value={s.streetAddress} wide />
            <Field label="City"  value={s.city} />
            <Field label="State" value={s.state} />
            <Field label="ZIP"   value={s.zip} />
            {s.raceClub && <Field label="Race Club / League" value={s.raceClub} wide />}
          </div>
        </div>

        <div className="sub-section">
          <div className="sub-section-title">Vehicle Information</div>
          <div className="sub-grid">
            <Field label="Year"  value={s.vehicleYear} />
            <Field label="Make"  value={s.vehicleMake} />
            <Field label="Model" value={s.vehicleModel} />
            <Field label="Color" value={s.vehicleColor} />
            <Field label="VIN"   value={s.vin} wide />
            <Field label="DMV Registered"        value={dash(s.dmvRegistered)} />
            <Field label="Licensed for Road Use" value={dash(s.licensedForRoad)} />
          </div>
        </div>

        <div className="sub-section">
          <div className="sub-section-title">Documents Uploaded</div>
          <div className="sub-grid">
            <DownloadBtn content={s.docTrailerContent} filename={s.docTrailerName} />
            <DownloadBtn content={s.docNonRoadContent} filename={s.docNonRoadName} />
            <DownloadBtn content={s.docEventContent}   filename={s.docEventName} />
            {s.docClubName && <DownloadBtn content={s.docClubContent} filename={s.docClubName} />}
          </div>
        </div>

        <div className="sub-section">
          <div className="sub-section-title">Compliance</div>
          <div className="sub-grid">
            <div className="sub-item wide"><span className="lbl">Product is for racing/off-road use only</span><YN v={s.racingUseOnly} /></div>
            <div className="sub-item wide"><span className="lbl">Vehicle not operated on public roads</span><YN v={s.notOnPublicRoads} /></div>
            <div className="sub-item wide"><span className="lbl">Acknowledges product is not CARB approved</span><YN v={s.notCarbApproved} /></div>
            <div className="sub-item wide"><span className="lbl">Acknowledges product is not EPA certified</span><YN v={s.notEpaCertified} /></div>
          </div>
        </div>

        <div className="sub-section wide">
          <div className="sub-section-title">Signature &amp; Certification</div>
          <div className="sub-grid">
            <Field label="Printed Name" value={s.printedName} />
            <Field label="Date Signed"  value={s.signatureDate} />
            <div className="sub-item wide"><span className="lbl">Understands product is not CARB approved</span><YN v={s.certCarbApproved} /></div>
            <div className="sub-item wide"><span className="lbl">Understands product may not be EPA certified</span><YN v={s.certEpaCertified} /></div>
            <div className="sub-item wide"><span className="lbl">Certifies racing/off-road use only (under penalty of perjury)</span><YN v={s.certPerjury} /></div>
          </div>
          {s.digitalSignature && (
            <div className="sub-sig-wrap">
              <span className="lbl">Digital Signature</span>
              <img src={s.digitalSignature} alt="Digital signature" className="sub-sig-img" />
            </div>
          )}
        </div>

        <div className="sub-meta">
          Shop: <code>{s.shop}</code> &bull; Product: <code>{s.productHandle}</code> &bull; ID: <code>{s.id}</code> &bull; Submitted: {fmt(s.createdAt)}
        </div>
      </div>
    </div>
  );
}

function SubmissionRows({ s, globalIdx, expanded, toggle }) {
  const isOpen = expanded === s.id;
  return (
    <>
      <tr className={`sub-row${isOpen ? " sub-row-open" : ""}`} onClick={() => toggle(s.id)}>
        <td className="sub-num">{globalIdx}</td>
        <td style={{ whiteSpace: "nowrap" }}>{fmt(s.createdAt)}</td>
        <td><strong>{s.fullName}</strong></td>
        <td>{s.email}</td>
        <td>{s.phone}</td>
        <td><span className="sub-handle">{s.productHandle}</span></td>
        <td className="sub-vehicle">{s.vehicleYear} {s.vehicleMake} {s.vehicleModel}</td>
        <td>
          <button className={`sub-toggle-btn${isOpen ? " open" : ""}`}
            onClick={(e) => { e.stopPropagation(); toggle(s.id); }}>
            {isOpen ? "▲ Close" : "▼ Details"}
          </button>
        </td>
      </tr>
      {isOpen && (
        <tr className="sub-detail-row">
          <td colSpan={8}><Detail s={s} /></td>
        </tr>
      )}
    </>
  );
}

export default function FormSubmissions() {
  const { submissions, total, page } = useLoaderData();
  const [expanded, setExpanded] = useState(null);

  const toggle = (id) => setExpanded((prev) => (prev === id ? null : id));

  return (
    <s-page heading="Form Submissions">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      <div className="sub-header">
        <span className="sub-count">{total} total submission{total !== 1 ? "s" : ""}</span>
        {total > 0 && <ClearAllButton count={total} />}
      </div>

      {total === 0 ? (
        <div className="sub-empty">
          <p style={{ margin: 0, fontSize: "15px", fontWeight: 600, color: "#374151" }}>No submissions yet</p>
          <p style={{ margin: "6px 0 0" }}>Completed waiver forms will appear here automatically.</p>
        </div>
      ) : (
        <>
          <div className="sub-table-wrap">
            <table className="sub-table">
              <thead>
                <tr>
                  <th className="sub-num">#</th>
                  <th>Submitted</th>
                  <th>Full Name</th>
                  <th>Email</th>
                  <th>Phone</th>
                  <th>Product</th>
                  <th>Vehicle</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {submissions.map((s, idx) => (
                  <SubmissionRows
                    key={s.id}
                    s={s}
                    globalIdx={(page - 1) * PER_PAGE + idx + 1}
                    expanded={expanded}
                    toggle={toggle}
                  />
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} total={total} />
        </>
      )}
    </s-page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
