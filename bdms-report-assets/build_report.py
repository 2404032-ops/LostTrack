from pathlib import Path

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_CELL_VERTICAL_ALIGNMENT
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor

ROOT = Path(r"D:\All Project Proposal Idea\LostTract_Project")
ASSETS = ROOT / "bdms-report-assets"
OUTPUT = ROOT / "BDMS_Project_Report_LostTrack.docx"
doc = Document()
section = doc.sections[0]
section.page_width = Inches(8.27)
section.page_height = Inches(11.69)
section.top_margin = Inches(1)
section.bottom_margin = Inches(1)
section.left_margin = Inches(1)
section.right_margin = Inches(1)
section.header_distance = Inches(.5)
section.footer_distance = Inches(.5)

normal = doc.styles["Normal"]
normal.font.name = "Times New Roman"
normal.font.size = Pt(12)
normal.font.color.rgb = RGBColor(0, 0, 0)
normal.paragraph_format.space_after = Pt(6)
normal.paragraph_format.line_spacing = 1.5
for name, size, color in [
    ("Title", 22, (0, 0, 0)),
    ("Heading 1", 16, (0, 0, 0)),
    ("Heading 2", 13, (0, 0, 0)),
]:
    style = doc.styles[name]
    style.font.name = "Times New Roman"
    style.font.size = Pt(size)
    style.font.bold = True
    style.font.color.rgb = RGBColor(*color)
    style.paragraph_format.space_before = Pt(10 if name != "Title" else 0)
    style.paragraph_format.space_after = Pt(5)
    style.paragraph_format.keep_with_next = True

header = section.header.paragraphs[0]
header.alignment = WD_ALIGN_PARAGRAPH.CENTER
run = header.add_run("LostTrack — CSE 202 Project Report")
run.font.size = Pt(8)
run.font.name = "Times New Roman"
footer = section.footer.paragraphs[0]
footer.alignment = WD_ALIGN_PARAGRAPH.CENTER
run = footer.add_run("Page ")
run.font.size = Pt(8)
run.font.name = "Times New Roman"
field = OxmlElement("w:fldSimple")
field.set(qn("w:instr"), "PAGE")
footer._p.append(field)


def para(text, style=None, center=False, italic=False):
    p = doc.add_paragraph(style=style)
    if center:
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = p.add_run(text)
    r.italic = italic
    return p


def heading(number, text, subtitle=None):
    if number in {"Preliminary", "Abstract", "Contents", "References"}:
        title = text or number
    else:
        title = f"{number}. {text}"
    doc.add_heading(title, level=1)
    if subtitle:
        para(subtitle, italic=True)


def page():
    return


def bullets(items):
    for item in items:
        p = doc.add_paragraph(style="List Bullet")
        p.paragraph_format.space_after = Pt(2)
        p.add_run(item)


def numbered(items):
    for item in items:
        p = doc.add_paragraph(style="List Number")
        p.paragraph_format.space_after = Pt(2)
        p.add_run(item)


def table(headers, rows, size=9):
    t = doc.add_table(rows=1, cols=len(headers))
    t.style = "Table Grid"
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    for i, value in enumerate(headers):
        cell = t.rows[0].cells[i]
        cell.text = str(value)
        shade = OxmlElement("w:shd")
        shade.set(qn("w:fill"), "E7E7E7")
        cell._tc.get_or_add_tcPr().append(shade)
        cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
        r = cell.paragraphs[0].runs[0]
        r.bold = True
        r.font.name = "Times New Roman"
        r.font.size = Pt(size)
        r.font.color.rgb = RGBColor(0, 0, 0)
    for idx, row in enumerate(rows):
        cells = t.add_row().cells
        for i, value in enumerate(row):
            cells[i].text = str(value)
            cells[i].vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
            p = cells[i].paragraphs[0]
            p.paragraph_format.space_after = Pt(1)
            p.paragraph_format.line_spacing = 1
            r = p.runs[0]
            r.font.name = "Times New Roman"
            r.font.size = Pt(size)
    set_repeat_table_header(t.rows[0])
    doc.add_paragraph().paragraph_format.space_after = Pt(1)


def set_repeat_table_header(row):
    properties = row._tr.get_or_add_trPr()
    repeat = OxmlElement("w:tblHeader")
    repeat.set(qn("w:val"), "true")
    properties.append(repeat)


def figure(file, width, caption_text):
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.add_run().add_picture(str(ASSETS / file), width=Inches(width))
    p.paragraph_format.keep_together = True
    p.paragraph_format.space_after = Pt(2)
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.keep_together = True
    p.paragraph_format.space_after = Pt(6)
    r = p.add_run(caption_text)
    r.italic = True
    r.font.name = "Times New Roman"
    r.font.size = Pt(10)


# Cover page
para("UNIVERSITY OF FRONTIER TECHNOLOGY, BANGLADESH", center=True).runs[0].bold = True
para("CSE 202: DATABASE SYSTEMS SESSIONAL", center=True)
para("\nPROJECT REPORT", center=True).runs[0].font.size = Pt(22)
para("LostTrack", center=True).runs[0].font.size = Pt(26)
para("A Campus Lost-and-Found and Issue Management System", center=True)
para("\nSubmitted by\nTeam SANDHAN · Group 3\nMd Ifti Hossen Riyad (2404011)\nMd Eyasin (2404032)", center=True)
para("\nInstructor: Md. Abdullah\nDepartment of Cyber Security Engineering\nUniversity of Frontier Technology, Bangladesh", center=True)
para("\nGitHub: https://github.com/iftiurhossen11/LostTrack", center=True)
para("Prepared 19 November 2026", center=True)
para("\nDraft: confirm CSE 202 topic approval and contribution percentages before submission.", center=True, italic=True)
doc.add_page_break()

# Submission notes
page()
heading("Preliminary", "Submission and integrity notes")
para("This report follows the section checklist in the supplied “CSE 202: Database Systems Sessional — Final Project Description & Guidelines” [1]. The official CSE 202 report template was not present in the workspace; this document uses a clean academic layout. Transfer the content into the official template if the instructor has issued one.")
para("Topic approval is TO BE CONFIRMED. The handout requires instructor approval, but no separate CSE 202 approval evidence was supplied. Do not mark the topic approved until the instructor confirms it.")
para("Contribution percentages are also TO BE COMPLETED by the team. The handout requires truthful percentages totaling 100% and a highest-to-lowest gap of at least 10 percentage points. No percentages are invented here. Discuss actual tasks and evidence together. If the real contributions do not meet the numerical rule, report the truth and ask the instructor how to proceed.")
table(["Member", "Student ID", "Actual contribution %", "Evidence / tasks"], [
    ["Md Ifti Hossen Riyad", "2404011", "TO BE COMPLETED", "Record actual work; do not infer."],
    ["Md Eyasin", "2404032", "TO BE COMPLETED", "Record actual work; do not infer."],
    ["Total", "—", "Must equal 100%", "Confirm the gap against the handout."],
])
para("Screenshots and example records are synthetic. They are not real UFTB incident statistics or study results. Automated software tests do not replace participant-based evaluation or prove a production deployment.")

# Abstract
doc.add_page_break()
heading("Abstract", "")
para("LostTrack is a browser-based campus application that combines lost-and-found reporting with an environmental issue queue. Students can browse and report lost or found items, submit private ownership claims, and report campus issues such as waste or drainage. Approved Staff can progress assigned tasks. Main Administrators can review claims, manage accounts, set issue priorities, assign work, and delete reports.")
para("The backend is a Node.js HTTP service. Local development uses a JSON file; hosted persistence uses Supabase PostgreSQL with eleven normalized relational tables, row-level security, and two server-only RPC functions that preserve the application’s existing state API. Report images are stored in a private Supabase Storage bucket. This adapter makes persistence relational, but still replaces a full application snapshot on each write; it is a single-instance academic prototype, not a high-concurrency design.")
para("The report documents the problem, features, ER model, relational mapping, normalization, constraints, tools, roles, GUI, tests, and limitations. The submitted code passed syntax checks and the backend suite (22 tests) at preparation time. These results do not replace instructor review or usability evaluation. Screenshots use synthetic records. No public deployment or participant study is claimed. CSE 202 topic approval and actual team contributions remain to be confirmed.")
para("Keywords: database systems, PostgreSQL, normalization, campus lost-and-found, CRUD, role-based access, UFTB.")

# Contents
doc.add_page_break()
heading("Contents", "")
for item in [
    "1. Project description and context", "2. Problem statement and objectives",
    "3. Scope and requirements", "4. Key features and workflows",
    "5. Tools and technologies", "6. System architecture", "7. ER model",
    "8. ER-to-relational mapping", "9. Relational data model",
    "10. Normalization", "11. Integrity and constraints",
    "12. Database implementation", "13. CRUD implementation",
    "14. Roles and permissions", "15. GUI screenshots",
    "16. Testing and verification", "17. Security, privacy, and ethics",
    "18. Setup and deployment", "19. Limitations and future work",
    "20. Conclusion", "References", "Appendix A. Table summary",
    "Appendix B. Submission checklist",
]:
    para(item)
para("Update this contents list and page numbers after transferring the report to the official course template, if required.")

# Project description
doc.add_page_break()
heading("1", "Project description and context")
para("LostTrack simulates a campus helpdesk that receives two related kinds of reports. The first is a lost-and-found item record: what was lost or found, its category, where and when it was seen, and a public description. The second is a campus issue report: a place-based concern such as drainage or waste that needs review and possibly a maintenance task. The web application organizes these records in one searchable interface and gives each role a limited set of actions.")
para("Informal reports can be difficult to search, duplicate, or track. LostTrack makes report status visible to signed-in campus users and records a history of administrative actions. For found items, claimant details and the administrator’s private clue are kept out of the campus report view. The claimant provides details; an administrator decides whether they are sufficient. The application does not claim to make automated ownership determinations.")
para("The environmental issue module is a workflow tool rather than a sensor system. Users can submit a report and vote once on an open issue after university-email verification. Votes are one input to an explainable priority suggestion, alongside severity, safety and age; an administrator remains responsible for the final priority. No UFTB demand baseline or user study is claimed.")

# Objectives and requirements
page()
heading("2", "Problem statement and objectives")
para("The project problem is the lack of a single, structured place to record item reports and campus issues, follow their status, and assign responsibility. Informal posts can be hard to search, duplicate earlier reports, and omit role-specific review or an audit history. LostTrack demonstrates a database-backed workflow for those needs.")
bullets([
    "Translate a campus reporting scenario into entities, attributes, keys, and relationships.",
    "Convert the model to relational tables with keys, constraints, and normalization.",
    "Implement the schema in PostgreSQL and connect it to an application API.",
    "Provide a GUI with Create, Read, Update, and Delete for reports under role-based authorization.",
    "Separate Student, Staff, and Main Admin responsibilities and protect private claim information.",
    "Test core API behavior and report limitations accurately.",
])
para("A prior team research document cites an Indian university survey and Bangladeshi campus waste studies as context [8]. Those external studies are not UFTB measurements and are not evidence that LostTrack improves campus outcomes.")

page()
heading("3", "Scope and requirements")
table(["Requirement", "Design response", "Evidence"], [
    ["Working GUI", "Responsive browser UI, forms, dashboards, map", "Figures in Section 15"],
    ["Multiple roles", "Student, approved Staff, Main Admin", "Server authorization tests"],
    ["CRUD", "Create/read, owner update, admin delete", "API and CRUD test"],
    ["Real DBMS", "Supabase PostgreSQL, normalized relations", "Migration and RPC check"],
    ["ER and relational models", "ER diagram plus table/key listing", "Sections 7–9"],
    ["Public GitHub", "README and repository URL", "Verify pushed commit"],
    ["Report", "This document with screenshots and references", "Template/approval pending"],
])
para("In scope are report management, role enforcement, voting, claim review, task assignment, history, Bangladesh map context, and hosted persistence. Out of scope are production campus identity, push notifications, native mobile apps, institutional legal approval, guaranteed email delivery, high availability, and real evaluation results.")
para("Only the Main Admin can permanently delete a report because this also removes claims, private clues, tasks, and history. Owners may update their own eligible reports. Any alternative deletion policy should be agreed before changing the implementation.")

# Features and workflows
page()
heading("4", "Key features and workflows")
doc.add_heading("Lost-and-found", level=2)
numbered([
    "A verified campus account submits a lost or found report with title, category, location, date, and optional description and images.",
    "The report is visible to signed-in campus users. Possible lost/found matches show a factor breakdown but do not determine ownership.",
    "A claimant submits private details and consent for an available found item.",
    "The administrator compares those details with a separately stored private clue and approves, rejects, or requests more information.",
    "At handover, the administrator checks identity in person and records the return.",
])
doc.add_heading("Campus issue", level=2)
numbered([
    "A verified user reports a campus issue and may add an in-Bangladesh pin.",
    "Verified Students and Staff may vote once while the issue is open.",
    "Severity, risk, votes, and age contribute to a suggested score; the administrator may override with a reason.",
    "The administrator assigns work to active Staff.",
    "Assigned Staff progress the task; the administrator reviews and resolves the report.",
])
para("These workflows map to separate account, report, claim, task, vote, and history relations rather than nested repeating lists in the report row.")

# Tools and architecture
page()
heading("5", "Tools and technologies")
table(["Layer", "Technology", "Use"], [
    ["Frontend", "HTML5, CSS, vanilla JavaScript", "Responsive GUI and forms"],
    ["Map", "Leaflet 1.9", "Bangladesh location picker and pins"],
    ["Backend", "Node.js 20–26; built-in HTTP modules", "API, validation, roles, business rules"],
    ["Hosted DBMS", "PostgreSQL via Supabase", "Tables, keys, transactions, RPC"],
    ["Images", "Supabase private Storage", "Server-controlled report images"],
    ["Email", "Brevo HTTPS API or local SMTP", "Verification and reset links, if configured"],
    ["Tests", "Node.js built-in test runner", "API and regression checks"],
    ["Development", "VS Code; Windows environment", "Editing and local testing"],
])
para("The map uses Leaflet and credits its tile and geocoding providers. Boundary data restricts selectable/saved coordinates to Bangladesh; it does not make user-entered place names authoritative.")

page()
heading("6", "System architecture")
para("The browser sends JSON requests to the Node.js API. The API authenticates a session, applies role and input checks, reads or changes application data, and returns a role-filtered view. Local development uses an atomically replaced JSON file. Hosted mode calls Supabase PostgREST RPC endpoints. The service-role key must remain server-side.")
para("The database has eleven PostgreSQL tables. `get_losttrack_state()` assembles relational rows into the application’s existing JSON response contract. `replace_losttrack_state(p_state)` applies a new snapshot within one database function transaction. Image bytes use the separate private Storage bucket; the database stores object URLs, not binary content.")
para("The key trade-off is that each write rebuilds the relational snapshot. The function is atomic, but the pattern increases write cost and can overwrite concurrent updates. It demonstrates relational persistence for a single-instance course prototype; production should use operation-level SQL transactions and concurrency control.")
figure("architecture.png", 6.2, "Figure 1. Browser, API, relational database, and private image storage.")
para("Figure 1 shows the principal paths. The diagram is an architectural summary; the SQL migration and application code are implementation evidence.")

# ER model
page()
heading("7", "ER model")
para("The model centers on Campus, Account, and Report. A campus can have many accounts and reports; an account can create many reports. Each report may have photos, claims, private clues, notifications, assigned tasks, and history entries. Accounts and reports have an M:N voting relationship resolved by `report_votes`; a composite key prevents duplicate votes per account and report.")
para("Claims link a claimant account to an available found report. Maintenance tasks link a report to the Staff account responsible. Notifications are directed to an account and may reference a report; deleting a report clears that reference. Password-reset tokens belong to accounts. Photo and history rows use parent keys and ordering fields.")
figure("erd.png", 6.2, "Figure 2. ER model. PK denotes primary key and FK denotes foreign key.")
para("As shown in Figure 2, repeating child records are separate relations. The diagram summarizes key attributes; full listings follow in Sections 8 and 9.")

# ER mapping
page()
heading("8", "ER-to-relational mapping")
para("Each strong entity becomes a table with a primary key. One-to-many relationships use a foreign key on the many-side. The account-to-report voting M:N relationship becomes an associative table with two foreign keys and a composite key. Report photos and history use a parent key plus position/order to preserve identity and sequence.")
table(["Relationship", "Relational mapping", "Cardinality / rule"], [
    ["Campus → Account", "accounts.campus_id → campuses.id", "1:N; required FK"],
    ["Campus → Report", "reports.campus_id → campuses.id", "1:N; required FK"],
    ["Account → Report creator", "reports.created_by → accounts.id", "1:N; required FK"],
    ["Account ↔ issue votes", "report_votes(report_id,user_id)", "M:N; composite PK"],
    ["Report → Photo", "report_photos.report_id → reports.id", "1:N; cascade"],
    ["Report → Claim", "claims.report_id → reports.id", "1:N; cascade"],
    ["Account → Claimant", "claims.claimant_id → accounts.id", "1:N; FK"],
    ["Report → Task", "maintenance_tasks.report_id → reports.id", "1:N; cascade"],
    ["Account → Assignee", "maintenance_tasks.assignee_id → accounts.id", "1:N; FK"],
])
para("Some logical references, including `reports.duplicate_of`, are not foreign keys. A future schema revision should add an explicit self-reference and define its delete behavior.")

# Schema listing
page()
heading("9", "Relational data model")
table(["Relation", "Primary key", "Important attributes / foreign keys"], [
    ["campuses", "id", "name"],
    ["accounts", "id", "email UNIQUE; role/status; password hash; verification and consent fields; campus_id FK"],
    ["reports", "id", "type, title, category, place, date, description, coordinates, status, priority, creator FK, campus FK, timestamps"],
    ["report_photos", "(report_id, position)", "photo_url; report_id FK ON DELETE CASCADE"],
    ["report_votes", "(report_id, user_id)", "created_at; both are cascading FKs"],
    ["private_clues", "id", "report_id FK; recorded_by FK; clue and timestamps"],
    ["claims", "id", "report_id, claimant, reviewer, reopener FKs; detail, consent, attempt, review fields"],
    ["notifications", "id", "user_id FK; nullable ref_id FK ON DELETE SET NULL; message, is_read"],
    ["maintenance_tasks", "id", "report_id FK; assignee_id FK; task status and timestamps"],
    ["report_history", "(report_id, entry_order)", "entry; report_id FK ON DELETE CASCADE"],
    ["password_resets", "token_hash", "account_id FK ON DELETE CASCADE; expires_at"],
])
para("The table names use snake_case; API properties use camelCase. The RPC maps between the two. Raw authentication tokens remain in the in-memory session layer. Claim detail is restricted by API role filtering. The service-role key is privileged and must remain secret.")

# Normalization
page()
heading("10", "Normalization analysis")
para("The intended relations are in third normal form for the modeled dependencies: non-key attributes describe the key, the whole key, and not another non-key attribute. This claim is limited to the presented schema; it does not mean every business or concurrency rule is solved.")
doc.add_heading("First normal form", level=2)
para("Ordinary fields are scalar. Repeating report photos, votes, history, claims, and tasks are separate rows rather than arrays or comma-separated values in `reports`.")
doc.add_heading("Second normal form", level=2)
para("Composite keys appear in `report_photos`, `report_votes`, and `report_history`. Their non-key values depend on the complete key: a photo URL depends on report and position; a vote timestamp depends on report and account; a history entry depends on report and order.")
doc.add_heading("Third normal form", level=2)
para("Campus names live in `campuses`, referenced by `campus_id`, rather than repeated on every account and report. Task assignee identity uses an account foreign key rather than duplicating names/emails in the relational task row. Voting is represented by a composite key. The RPC joins names and emails into API responses without storing those duplicate values in `maintenance_tasks`.")
para("Some status values and `duplicate_of` need additional integrity constraints. Normalization is about data dependencies, not creating a table for every column; excessive decomposition can also reduce clarity.")

# Integrity
page()
heading("11", "Integrity constraints and deletion behavior")
para("PostgreSQL enforces account email uniqueness; role values restricted to user/staff/admin; report types restricted to lost/found/issue; priority and severity vocabularies; coordinate pairing/ranges; photo positions one through three; and unique votes per account and report. Foreign keys prevent children pointing to missing campus, account, or report rows.")
para("Deleting a report cascades to photos, votes, claims, private clues, tasks, and history. Notification report references become NULL so the notification remains without a broken link. The application delete endpoint applies the same cleanup locally and removes hosted image objects after committing the relational snapshot.")
para("The API enforces workflow rules: a user cannot claim their own found item, only open issues can be voted on, claims require consent and an available found item, Staff can update only assigned tasks, and status transitions must be valid. These are server-side rules covered by automated tests; PostgreSQL remains the integrity boundary for keys and scalar checks.")

# Implementation
page()
heading("12", "Database implementation and transactions")
para("The migration `backend/migrations/002-normalized-relational-schema.sql` creates eleven tables and indexes for report status, creator chronology, claim review, assigned work, and notifications. It enables row-level security and revokes direct table access from `anon` and `authenticated`. RPC access is granted to `service_role` only.")
para("`get_losttrack_state()` returns the relational data as one JSON value with deterministic child ordering. `replace_losttrack_state(p_state)` checks that its input is a JSON object and rewrites the relational snapshot. A failed cast or constraint aborts the PostgreSQL function transaction rather than leaving a partly replaced snapshot.")
para("A compatibility block imports the previous JSONB `losttrack_state` row if present, before dropping that table. Back up any database with records before applying schema changes. The migration ran successfully in the configured Supabase project and its read RPC returned the expected empty collections. This proves migration and read access, not yet a full hosted multi-table write test.")
para("The Node adapter now calls `rpc/get_losttrack_state` and `rpc/replace_losttrack_state`. A mocked Supabase test verifies persistence across server restarts. A safe end-to-end write/restore check against the hosted project remains recommended before deployment.")

# CRUD
page()
heading("13", "CRUD implementation")
table(["Operation", "User action / API", "Authorization and effect"], [
    ["Create", "New report form; POST /api/state", "Verified Student/Staff; server validates fields and consent"],
    ["Read", "Board, list, map; GET /api/state", "Signed-in roles receive filtered state"],
    ["Update", "Owner edits eligible report; admin reviews", "Owner edits own open/found report; server controls transitions"],
    ["Delete", "Admin Delete report; DELETE /api/admin/reports/:id", "Admin only; removes report and dependent records/images"],
])
para("Deletion is permanent and requires browser confirmation. It is restricted to Main Admin because it also removes claims, clues, tasks, and history. A successful response refreshes admin state. If database persistence fails, the API reports an error. If database deletion succeeds but image cleanup fails, the API returns a specific partial-completion error and logs the cleanup failure.")
para("Create, read, and update continue to use the established state API for compatibility; the dedicated DELETE endpoint closes the report CRUD gap. Tests verify Student denial and cleanup of dependent claims, clues, tasks, and notification references.")

# Roles
page()
heading("14", "Roles and permissions")
table(["Role", "Read", "Create / update", "Administrative actions"], [
    ["Student", "Campus reports; own claims and alerts", "Create/edit own eligible reports; vote; claim", "No approvals, assignment, or permanent delete"],
    ["Approved Staff", "Campus reports; own tasks", "Create/edit; vote; claim; progress assigned tasks", "Cannot review other claims or reassign work"],
    ["Main Admin", "Reports, clues, claims, accounts, tasks", "Create; change status/priority; manage clues/tasks", "Approve Staff, review claims, assign, delete, export"],
])
para("The server checks roles for protected operations; hiding a browser button is not the security boundary. Email verification gates Student/Staff contributions. Public registration cannot create an administrator; initial admin provisioning uses server environment variables only when no active admin exists.")
para("The API omits private clues for non-admin roles and does not return other users’ claim details. Row-level security protects direct access through less-privileged database roles, but the backend service-role credential can access all tables and must remain secret.")

# GUI
page()
heading("15", "GUI screenshots")
para("Figure 3 shows the sign-in screen. University email and password are sent to the API. Account creation, password recovery, email verification, and role selection are part of the authentication workflow. This is a local visual capture, not a production account.")
figure("login.png", 5.2, "Figure 3. LostTrack sign-in page (local capture).")
para("Figure 4 shows the administrator dashboard with synthetic demonstration reports. Counts and charts are derived from those sample records and are not actual UFTB campus measurements.")
figure("admin-dashboard-summary.png", 3.9, "Figure 4. Main Admin dashboard with synthetic report data.")
para("As shown in Figure 4, report statistics are derived from the report collection and the work queue provides paths to review actions.")

page()
heading("16", "GUI screenshots: report form and map")
para("Figure 5 shows report type, title, category, location, date, Bangladesh-only search and pin selection, photos, description, and consent. Text-only locations are allowed when no pin is selected. Search is user-triggered and the interface warns against entering personal search terms.")
figure("report-form-map-crop.png", 4.2, "Figure 5. Report form and Bangladesh boundary map.")
para("Figure 6 shows the All Reports view and map. One synthetic issue has a pin; the other sample report has typed location only. Search and filters allow inspection by title, location, type, category, colour, date, or status.")
figure("all-reports-map-crop.png", 4.2, "Figure 6. Report list and map with synthetic records.")
para("The map is not an authoritative geographic record. Boundary checks constrain coordinates, but location text remains user-entered.")

# Tests
page()
heading("17", "Testing and verification")
para("The Node.js test suite launches isolated local API servers and uses temporary databases. Coverage includes request parsing and byte limits, authorization, privacy fields, email verification, retention, initial admin provisioning, mocked Supabase restart persistence, location search boundaries and rate limits, report creation and duplicate handling, scoring, claims, Staff task progression, image validation, email behavior, identity checks, and report deletion.")
table(["Check", "Result at preparation", "What it establishes"], [
    ["npm run check", "Passed", "Syntax checks across backend, frontend and tests"],
    ["npm test", "22 passed", "Automated behavior on isolated test fixtures"],
    ["git diff --check", "Passed", "No whitespace errors in current changes"],
    ["Supabase migration", "Succeeded", "Tables/RPC created and legacy table migration completed"],
    ["Supabase read RPC", "Expected empty state", "RPC reachable and returns expected JSON structure"],
    ["Local browser", "Views captured", "GUI rendered with synthetic records"],
])
para("These checks do not prove a real Brevo sender, Render deployment, concurrent multi-instance safety, or usability. No participant study or matching-precision evaluation is claimed. For the course demo, create a disposable report, read it as another role, update it as its owner, and delete it as Main Admin.")

# Security/privacy
page()
heading("18", "Security, privacy, and ethics")
bullets([
    "Passwords use salted scrypt hashes; raw passwords are not stored.",
    "Service-role and mail credentials stay in backend secrets, never frontend code or Git.",
    "Roles, verification, input checks, ownership, and workflow transitions are enforced by the API.",
    "Private clues and other claimants’ details are omitted from Student/Staff responses.",
    "RLS is enabled; direct anon/authenticated table access and RPC execution are revoked.",
    "Deletion removes dependent records and attempts to remove image objects. Do not upload IDs, faces, receipts, or contact details.",
    "Consent and retention notices are shown; institutional legal/privacy approval is still required.",
])
para("OWASP identifies broken access control as a major web risk [4]. Passing tests is not a formal security audit. Production hardening needs a threat model, dependency review, key rotation, backups, audit monitoring, session review, and approved institutional retention policy.")
para("Crowd votes can reflect participation differences. Votes are not automatic decisions: severity, risk, and age also contribute, and an administrator remains accountable for overrides. This is a design mitigation, not proof that bias is eliminated.")

# Setup
page()
heading("19", "Setup and deployment")
para("For local development, install Node.js, copy `.env.example` to `.env`, enter an initial admin email and strong password, install dependencies, and run `npm start`. The default server listens on localhost port 3000. Use a second terminal for `npm run check` and `npm test`. Keep `.env`, local database files, and uploaded data out of Git.")
para("For hosted PostgreSQL, apply `backend/migrations/002-normalized-relational-schema.sql`, configure the Supabase project URL and server-only service role key, and verify the RPC read. The app creates a private storage bucket on startup. Email requires a verified Brevo sender and API key or suitable SMTP credentials. Free hosting may sleep or pause; it is not production service.")
para("The project repository is `https://github.com/iftiurhossen11/LostTrack`. Before course submission, verify that the evaluated commit, migration, tests, README, and report are visible in the repository. Never include secrets or user data.")
para("Record the exact commit hash, Node version, migration date, and whether the assessed demo used local JSON or Supabase. A local demo and deployed site have different persistence and email behavior; state which was evaluated.")

# Limitations
page()
heading("20", "Limitations and future work")
bullets([
    "Snapshot persistence rewrites all tables and is unsuitable for concurrent multi-instance use; replace it with targeted SQL transactions.",
    "The migration and read RPC were verified, but a full hosted write/restore test remains recommended.",
    "Screenshots use synthetic data; no UFTB demand survey, usability study, or matching-precision evaluation is claimed.",
    "Add stronger status constraints and a foreign key for `duplicate_of` with an intentional delete policy.",
    "Email depends on provider approval and a verified sender; no institutional identity provider is integrated.",
    "Free-tier backups, uptime, email delivery, and provider limits are not guaranteed.",
    "Official course template and instructor topic approval have not been supplied; confirm these items.",
    "Team contribution percentages must be recorded truthfully by the team.",
])
para("Future work should first replace snapshot writes with operation-level transactions, then add stronger constraints and an end-to-end Supabase test. Follow with accessibility and usability reviews, a campus-approved privacy review, and evaluation using consenting participants and a documented matching dataset.")

# Conclusion
page()
heading("21", "Conclusion")
para("LostTrack demonstrates translating a campus workflow into a GUI backed by a relational DBMS. The report identifies entities, converts one-to-many and many-to-many relationships into foreign keys and associative relations, and explains how normalization avoids repeated child lists. PostgreSQL checks keys and basic domains; the API enforces role permissions and workflow rules.")
para("The application supports report Create, Read, Update, and Delete: a verified campus user creates a report, signed-in roles read it, its owner may update an eligible report, and the Main Admin may permanently delete it with dependent-data cleanup. The browser provides role-specific workflows and a Bangladesh map, while automated tests check core API behavior.")
para("The main lesson is that schema, API, privacy, and GUI design must be evaluated together. Relational tables alone do not ensure correct authorization, and passing tests do not establish production readiness. The RPC adapter bridges an existing state-based application to normalized persistence but should be replaced with targeted transactions before concurrent campus use.")
para("Before submission, confirm instructor topic approval, use the official template if issued, complete factual contribution percentages, record the evaluated commit, and conduct a live CRUD walkthrough. These course-specific actions are not claimed as completed.")

# References
page()
heading("References", "")
for ref in [
    "[1] University of Frontier Technology, Bangladesh. CSE 202: Database Systems Sessional — Final Project Description & Guidelines. User-provided course handout.",
    "[2] PostgreSQL Global Development Group. PostgreSQL Documentation: Constraints. https://www.postgresql.org/docs/current/ddl-constraints.html (accessed 19 Nov 2026).",
    "[3] Supabase. Row Level Security. https://supabase.com/docs/guides/database/postgres/row-level-security (accessed 19 Nov 2026).",
    "[4] OWASP Foundation. OWASP Top 10:2025. https://owasp.org/Top10/2025/ (accessed 19 Nov 2026).",
    "[5] Leaflet. Leaflet 1.9.4 Reference. https://leafletjs.com/reference.html (accessed 19 Nov 2026).",
    "[6] OpenStreetMap contributors. Copyright and attribution. https://www.openstreetmap.org/copyright (accessed 19 Nov 2026).",
    "[7] OpenStreetMap Nominatim. Search API Usage Policy. https://operations.osmfoundation.org/policies/nominatim/ (accessed 19 Nov 2026).",
    "[8] Team SANDHAN. LostTrack: Research Report, project workspace copy. Used only for contextual references and team details; not treated as a CSE 202 template or evaluation evidence.",
]:
    para(ref)
para("Check source availability and the instructor’s citation requirements before final submission. Add any additional sources the team actually consulted.")

# Appendices
page()
heading("Appendix A", "Normalized table summary")
table(["Table", "Key and attribute summary"], [
    ["campuses", "id PK; name"],
    ["accounts", "id PK; email UNIQUE; name, roles, status, password hash; verification/consent fields; campus_id FK"],
    ["reports", "id PK; type, title, category, place, date, description, coordinates, severity, status, priority, creator/campus FKs, timestamps"],
    ["report_photos", "(report_id, position) PK; photo_url; report FK"],
    ["report_votes", "(report_id, user_id) PK; both are foreign keys"],
    ["private_clues", "id PK; report FK; recorded_by FK; clue and timestamps"],
    ["claims", "id PK; report, claimant, reviewer and reopener FKs; detail, consent, attempt and review fields"],
    ["notifications", "id PK; user FK; nullable report ref FK; message and read flag"],
    ["maintenance_tasks", "id PK; report FK; assignee FK; status and timestamps"],
    ["report_history", "(report_id, entry_order) PK; entry"],
    ["password_resets", "token_hash PK; account FK; expiry"],
])
para("The migration file defines exact SQL types, checks, indexes, delete rules, RLS/grants, and RPC functions. Keep this table summary synchronized with the schema after future changes.")

page()
heading("Appendix B", "Final submission checklist")
numbered([
    "Confirm with the instructor that LostTrack is approved for CSE 202.",
    "Use the official course template if the instructor issued one.",
    "Complete contribution percentages only after agreeing on accurate figures and evidence; do not falsify values.",
    "Run `npm run check` and `npm test` on the exact commit submitted; record the hash and results.",
    "Back up before schema changes; confirm all eleven tables and both RPC functions.",
    "Walk through create, read, update, and admin delete with disposable records; verify role denial and dependent cleanup.",
    "Use synthetic screenshots only; do not include secrets, real claim details, or personal documents.",
    "Push the final changes to the public repository and verify the README, migration, report, screenshots, and tests.",
    "State whether evaluation used local JSON or hosted Supabase; do not claim a live deployment unless tested.",
])
para("Keep `.env`, local state, credentials, and personal user data out of the public repository.")

props = doc.core_properties
props.title = "LostTrack CSE 202 Database Systems Project Report"
props.subject = "BDMS final project report"
props.author = "Team SANDHAN"
props.keywords = "CSE 202, database systems, PostgreSQL, normalization, LostTrack"
doc.save(OUTPUT)
print(f"Created {OUTPUT}")
print(f"Sections: {sum(1 for p in doc.paragraphs for r in p.runs if 'w:type=\"page\"' in r._element.xml) + 1}")
print(f"Tables: {len(doc.tables)}; figures: {len(doc.inline_shapes)}")
