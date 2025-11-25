// public/index.js
// Frontend logic for students, subjects, marking, bulk, delete, history, subject-wise view
document.addEventListener('DOMContentLoaded', () => {
  init();
});

function init() {
  setTodayDate();
  bindUI();
  fetchAndRenderAll();
}

function setTodayDate() {
  const d = new Date().toISOString().split('T')[0];
  const md = document.getElementById('markDate');
  const ad = document.getElementById('attendanceDate');
  if (md) md.value = d;
  if (ad) ad.value = d;
  const clearDate = document.getElementById('clearDate');
  if (clearDate) clearDate.value = d;
}

function bindUI() {
  document.getElementById('addStudentForm')?.addEventListener('submit', createStudentHandler);
  document.getElementById('addSubjectForm')?.addEventListener('submit', createSubjectHandler);
  document.getElementById('markAttendanceForm')?.addEventListener('submit', markAttendanceFormHandler);
  document.getElementById('loadStudentsBtn')?.addEventListener('click', loadSubjectStudents);
  document.getElementById('bulkMarkPresent')?.addEventListener('click', () => bulkMark('present'));
  document.getElementById('bulkMarkAbsent')?.addEventListener('click', () => bulkMark('absent'));
  document.getElementById('clearDayBtn')?.addEventListener('click', onClearDay);
  document.getElementById('refreshBtn')?.addEventListener('click', fetchAndRenderAll);
}

// -------- basic API helpers ----------
async function apiGET(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
async function apiPOST(path, data) {
  return fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
}
async function apiDELETE(path) {
  return fetch(path, { method: 'DELETE' });
}

// -------- fetch & render all (subjects + students + history) ----------
async function fetchAndRenderAll() {
  try {
    const [subjects, students] = await Promise.all([ apiGET('/api/subjects'), apiGET('/api/students') ]);
    window.__subjects = subjects;
    window.__students = students;
    renderSubjects(subjects);
    renderStudents(students);
    populateSubjectDropdowns(subjects);
    populateStudentDropdowns(students);
    updateStatsFromSubjects(subjects);
    fetchAndRenderHistory();
  } catch (err) {
    console.error('fetchAll error', err);
    showNotification('Failed to load data', 'error');
  }
}

// -------- create student/subject ----------
async function createStudentHandler(e) {
  e.preventDefault();
  const enroll_id = document.getElementById('enrollId').value.trim();
  const name = document.getElementById('studentNameInput').value.trim();
  if (!enroll_id || !name) return showNotification('Enter enroll id and name', 'error');
  try {
    const res = await apiPOST('/api/students', { enroll_id, name });
    if (res.status === 201) {
      document.getElementById('enrollId').value = '';
      document.getElementById('studentNameInput').value = '';
      showNotification('Student added', 'success');
      await fetchAndRenderAll();
    } else {
      const b = await res.json();
      showNotification(b.error || 'Failed to add student', 'error');
    }
  } catch (err) { console.error(err); showNotification('Network error', 'error'); }
}

async function createSubjectHandler(e) {
  e.preventDefault();
  const name = document.getElementById('subjectName').value.trim();
  if (!name) return showNotification('Enter subject name', 'error');
  try {
    const res = await apiPOST('/api/subjects', { name });
    if (res.status === 201) {
      document.getElementById('subjectName').value = '';
      showNotification('Subject added', 'success');
      await fetchAndRenderAll();
    } else {
      const b = await res.json();
      showNotification(b.error || 'Failed to add subject', 'error');
    }
  } catch (err) { console.error(err); showNotification('Network error', 'error'); }
}

// -------- quick single form mark ----------
async function markAttendanceFormHandler(e) {
  e.preventDefault();
  const studentId = parseInt(document.getElementById('attendanceStudent').value);
  const subjectId = parseInt(document.getElementById('attendanceSubject').value);
  const date = document.getElementById('attendanceDate').value || new Date().toISOString().split('T')[0];
  const status = e.submitter?.value || 'present';
  if (!studentId || !subjectId || !date) return showNotification('Select student, subject & date', 'error');
  await markSingle(studentId, subjectId, date, status);
}

// -------- mark single student (used by subject-wise buttons and quick form) ----------
async function markSingle(studentId, subjectId, date, status) {
  try {
    const res = await apiPOST('/api/attendance', { studentId, subjectId, date, status });
    if (res.status === 201) {
      showNotification(`Marked ${status}`, status === 'present' ? 'success' : 'warning');
      await loadSubjectStudents(); // refresh if subject list active
      await fetchAndRenderAll();
    } else {
      const b = await res.json();
      showNotification(b.error || 'Failed to mark', 'error');
    }
  } catch (err) { console.error(err); showNotification('Network error', 'error'); }
}
window.markSingle = markSingle;

// -------- subject-wise: load students + status for date ----------
async function loadSubjectStudents() {
  const subjectId = document.getElementById('markSubject').value;
  const date = document.getElementById('markDate').value || new Date().toISOString().split('T')[0];
  if (!subjectId) return showNotification('Select a subject', 'error');
  try {
    const students = await apiGET(`/api/subjects/${subjectId}/students?date=${encodeURIComponent(date)}`);
    renderSubjectStudentsList(subjectId, date, students);
  } catch (err) { console.error(err); showNotification('Failed to load students', 'error'); }
}

function renderSubjectStudentsList(subjectId, date, students) {
  const container = document.getElementById('subjectStudentsContainer');
  if (!students || !students.length) { container.innerHTML = '<div>No students found.</div>'; return; }

  container.innerHTML = `
    <table>
      <thead><tr><th style="width:60px">Select</th><th>Enroll ID</th><th>Name</th><th>Status</th><th>Action</th></tr></thead>
      <tbody>
        ${students.map(s => `
          <tr data-student-id="${s.id}">
            <td style="text-align:center"><input type="checkbox" class="student-checkbox" value="${s.id}" ${s.status ? 'disabled' : ''}></td>
            <td>${escapeHtml(s.enroll_id)}</td>
            <td>${escapeHtml(s.name)}</td>
            <td>${s.status ? s.status.toUpperCase() : '-'}</td>
            <td>
              ${s.status ? `<button class="btn btn-warning small" disabled>Already ${s.status}</button> <button class="btn btn-danger small" data-delete-student-id="${s.id}" data-subject-id="${subjectId}" data-date="${date}">Delete</button>`
              : `<button class="btn btn-success small" onclick="markSingle(${s.id}, ${subjectId}, '${date}', 'present')">Present</button> <button class="btn btn-danger small" onclick="markSingle(${s.id}, ${subjectId}, '${date}', 'absent')">Absent</button>`}
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

// -------- bulk mark selected ----------
async function bulkMark(status) {
  const subjectId = document.getElementById('markSubject').value;
  const date = document.getElementById('markDate').value || new Date().toISOString().split('T')[0];
  if (!subjectId) return showNotification('Select a subject', 'error');
  const checked = Array.from(document.querySelectorAll('.student-checkbox:checked')).map(cb => parseInt(cb.value));
  if (!checked.length) return showNotification('No students selected', 'error');
  const records = checked.map(id => ({ studentId: id, status }));
  try {
    const res = await apiPOST('/api/attendance/bulk', { subjectId: parseInt(subjectId), date, records });
    if (res.ok) {
      const body = await res.json();
      showNotification(`Marked ${body.inserted} students`, 'success');
      await loadSubjectStudents();
      await fetchAndRenderAll();
    } else {
      const b = await res.json();
      showNotification(b.error || 'Bulk failed', 'error');
    }
  } catch (err) { console.error(err); showNotification('Network error', 'error'); }
}

// -------- delete helpers (call backend endpoints) ----------
async function deleteAttendanceById(recordId) {
  if (!confirm('Delete this attendance record?')) return;
  try {
    const res = await apiDELETE(`/api/attendance/${recordId}`);
    if (res.ok) { showNotification('Record deleted', 'success'); await fetchAndRenderAll(); await loadSubjectStudents(); }
    else { const b = await res.json(); showNotification(b.error || 'Delete failed', 'error'); }
  } catch (err) { console.error(err); showNotification('Network error', 'error'); }
}
window.deleteAttendanceById = deleteAttendanceById;

async function deleteAttendanceByFilter({ subjectId, date, studentId = null }) {
  if (!subjectId || !date) return showNotification('subjectId and date required', 'error');
  const confirmMsg = studentId ? 'Delete this student record?' : 'Delete all attendance for this subject & date?';
  if (!confirm(confirmMsg)) return;
  try {
    let url = `/api/attendance?subjectId=${encodeURIComponent(subjectId)}&date=${encodeURIComponent(date)}`;
    if (studentId) url += `&studentId=${encodeURIComponent(studentId)}`;
    const res = await apiDELETE(url);
    if (res.ok) {
      const body = await res.json();
      showNotification(`Deleted ${body.deleted || body.deleted || body.deleted || 0} records`, 'success');
      await fetchAndRenderAll();
      await loadSubjectStudents();
    } else {
      const b = await res.json();
      showNotification(b.error || 'Delete failed', 'error');
    }
  } catch (err) { console.error(err); showNotification('Network error', 'error'); }
}
window.deleteAttendanceByFilter = deleteAttendanceByFilter;

async function deleteStudent(studentId) {
  if (!confirm('Delete student and all related attendance?')) return;
  try {
    const res = await apiDELETE(`/api/students/${studentId}`);
    if (res.ok) { showNotification('Student deleted', 'success'); await fetchAndRenderAll(); }
    else { const b = await res.json(); showNotification(b.error || 'Delete failed', 'error'); }
  } catch (err) { console.error(err); showNotification('Network error', 'error'); }
}
window.deleteStudent = deleteStudent;

async function deleteSubject(subjectId) {
  if (!confirm('Delete subject and all related attendance?')) return;
  try {
    const res = await apiDELETE(`/api/subjects/${subjectId}`);
    if (res.ok) { showNotification('Subject deleted', 'success'); await fetchAndRenderAll(); }
    else { const b = await res.json(); showNotification(b.error || 'Delete failed', 'error'); }
  } catch (err) { console.error(err); showNotification('Network error', 'error'); }
}
window.deleteSubject = deleteSubject;

// Clear day handler (button near subject-wise)
async function onClearDay() {
  const subjectId = document.getElementById('markSubject').value;
  const date = document.getElementById('markDate').value || new Date().toISOString().split('T')[0];
  if (!subjectId) return showNotification('Select subject to clear', 'error');
  await deleteAttendanceByFilter({ subjectId, date });
}

// -------- history rendering ----------
async function fetchAndRenderHistory() {
  try {
    const rows = await apiGET('/api/attendance');
    const container = document.getElementById('attendanceHistory');
    if (!rows.length) { container.innerHTML = '<div>No attendance records.</div>'; return; }
    container.innerHTML = rows.slice(0,200).map(r => `
      <div style="padding:8px;border-bottom:1px solid #eee;display:flex;justify-content:space-between;align-items:center">
        <div>${r.date} — <strong>${escapeHtml(r.subjectName)}</strong> — ${escapeHtml(r.enroll_id)} — <em>${r.status}</em></div>
        <div>
          <button class="btn btn-danger small" onclick="deleteAttendanceById(${r.id})">Delete</button>
        </div>
      </div>
    `).join('');
  } catch (err) { console.error(err); showNotification('Failed to load history', 'error'); }
}
async function fetchAndRenderHistoryWrapper(){ await fetchAndRenderHistory(); }

// expose for initial load
window.fetchAndRenderHistory = fetchAndRenderHistory;

// -------- renderers for Students / Subjects ----------
function renderStudents(students) {
  const container = document.getElementById('studentsList');
  if (!container) return;
  if (!students.length) { container.innerHTML = '<div>No students added.</div>'; return; }
  container.innerHTML = `
    <table>
      <thead><tr><th>Enroll ID</th><th>Name</th><th>Actions</th></tr></thead>
      <tbody>
        ${students.map(s => `<tr>
          <td>${escapeHtml(s.enroll_id)}</td>
          <td>${escapeHtml(s.name)}</td>
          <td>
            <button class="btn btn-warning small" onclick="viewStudent(${s.id})">View</button>
            <button class="btn btn-danger small" onclick="deleteStudent(${s.id})">Delete</button>
          </td>
        </tr>`).join('')}
      </tbody>
    </table>
  `;
}

function renderSubjects(subjects) {
  const container = document.getElementById('subjectsList');
  if (!container) return;
  if (!subjects.length) { container.innerHTML = '<div>No subjects.</div>'; return; }
  container.innerHTML = subjects.map(s => {
    const pct = s.totalClasses ? Math.round((s.present / s.totalClasses) * 100) : 0;
    return `
      <div class="subject-card">
        <strong>${escapeHtml(s.name)}</strong>
        <div style="margin-top:8px">Total: ${s.totalClasses} | Present: ${s.present}</div>
        <div style="margin-top:8px;display:flex;gap:8px">
          <button class="btn btn-primary small" onclick="showSubjectDetails(${s.id})">View Details</button>
          <button class="btn btn-danger small" onclick="deleteSubject(${s.id})">Delete</button>
        </div>
      </div>
    `;
  }).join('');
}

async function showSubjectDetails(subjectId) {
  const date = document.getElementById('markDate')?.value || new Date().toISOString().split('T')[0];
  try {
    const students = await apiGET(`/api/subjects/${subjectId}/students?date=${encodeURIComponent(date)}`);
    const modal = document.getElementById('detailsModal');
    document.getElementById('modalTitle').innerText = `Subject Attendance — ${date}`;
    if (!students.length) document.getElementById('modalBody').innerHTML = '<div>No students</div>';
    else {
      document.getElementById('modalBody').innerHTML = `<table><thead><tr><th>Enroll ID</th><th>Name</th><th>Status</th><th>Action</th></tr></thead><tbody>${students.map(s => `<tr><td>${escapeHtml(s.enroll_id)}</td><td>${escapeHtml(s.name)}</td><td>${s.status||'-'}</td><td>${s.status ? `<button class="btn btn-danger small" onclick="deleteAttendanceByFilter({subjectId:${subjectId},date:'${date}',studentId:${s.id}})">Delete</button>` : `<button class="btn btn-success small" onclick="markSingle(${s.id},${subjectId},'${date}','present')">Present</button> <button class="btn btn-danger small" onclick="markSingle(${s.id},${subjectId},'${date}','absent')">Absent</button>`}</td></tr>`).join('')}</tbody></table>`;
    }
    modal.style.display = 'flex';
  } catch (err) { console.error(err); showNotification('Failed to load details','error'); }
}

// view single student history
window.viewStudent = async function(studentId) {
  try {
    const rows = await apiGET(`/api/attendance?studentId=${studentId}`);
    const modal = document.getElementById('detailsModal');
    document.getElementById('modalTitle').innerText = 'Student Attendance';
    if (!rows.length) document.getElementById('modalBody').innerHTML = '<div>No records</div>';
    else document.getElementById('modalBody').innerHTML = rows.map(r => `<div style="padding:8px;border-bottom:1px solid #eee">${r.date} — <strong>${escapeHtml(r.subjectName)}</strong> — ${escapeHtml(r.enroll_id)} — <em>${r.status}</em> <button class="btn btn-danger small" style="margin-left:8px" onclick="deleteAttendanceById(${r.id})">Delete</button></div>`).join('');
    modal.style.display = 'flex';
  } catch (err) { console.error(err); showNotification('Failed to load student history','error'); }
};

// -------- dropdown population & stats ----------
function populateSubjectDropdowns(subjects) {
  const attendanceSubject = document.getElementById('attendanceSubject');
  const markSubject = document.getElementById('markSubject');
  const filterSubject = document.getElementById('filterSubject');
  if (attendanceSubject) attendanceSubject.innerHTML = '<option value="">Choose subject</option>' + subjects.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');
  if (markSubject) markSubject.innerHTML = '<option value="">Choose subject</option>' + subjects.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');
  if (filterSubject) filterSubject.innerHTML = '<option value="">All Subjects</option>' + subjects.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');
  // also copy into clearSubject if exists in DOM
  const clearSubject = document.getElementById('clearSubject');
  if (clearSubject) clearSubject.innerHTML = '<option value="">Select subject</option>' + subjects.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');
}

function populateStudentDropdowns(students) {
  const attendanceStudent = document.getElementById('attendanceStudent');
  if (attendanceStudent) attendanceStudent.innerHTML = '<option value="">Choose a student</option>' + students.map(s => `<option value="${s.id}">${escapeHtml(s.enroll_id)} — ${escapeHtml(s.name)}</option>`).join('');
}

function updateStatsFromSubjects(subjects) {
  document.getElementById('totalSubjects').textContent = subjects.length || 0;
  const totalClasses = subjects.reduce((a,b) => a + (b.totalClasses||0), 0);
  const totalPresent = subjects.reduce((a,b) => a + (b.present||0), 0);
  document.getElementById('totalClasses').textContent = totalClasses;
  document.getElementById('totalPresent').textContent = totalPresent;
  document.getElementById('overallPercentage').textContent = totalClasses ? ((totalPresent/totalClasses)*100).toFixed(2) + '%' : '0%';
}

// -------- utility ----------
function showNotification(msg, type='info') {
  // simple fallback notification (you can replace with fancier UI)
  const el = document.createElement('div');
  el.textContent = msg;
  el.style.cssText = 'position:fixed;top:18px;right:18px;padding:10px 14px;background:#111;color:#fff;border-radius:8px;z-index:99999';
  document.body.appendChild(el);
  setTimeout(()=>el.remove(),3000);
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, (m) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}
