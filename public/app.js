async function api(path, options = {}) {
  const res = await fetch(path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  if (res.status === 401) {
    window.location.href = '/signin';
    return Promise.reject(new Error('Unauthorized'));
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

async function loadMe() {
  try {
    const { user } = await api('/api/me');
    document.getElementById('user-name').textContent = user.name;
  } catch (e) {
    // redirected in api()
  }
}

async function renderNotes() {
  const container = document.getElementById('notes-list');
  const { notes } = await api('/api/notes');
  container.innerHTML = '';
  for (const note of notes) {
    const el = document.createElement('div');
    el.className = 'card';
    el.innerHTML = `
      <strong>${escapeHtml(note.title)}</strong>
      <div class="muted">Updated ${new Date(note.updated_at).toLocaleString()}</div>
      <div>${escapeHtml(note.content)}</div>
      <div class="note-actions">
        <button data-action="edit">Edit</button>
        <button data-action="delete" class="secondary">Delete</button>
      </div>
    `;
    el.querySelector('[data-action="edit"]').onclick = async () => {
      const title = prompt('Title', note.title);
      if (title === null) return;
      const content = prompt('Content', note.content);
      if (content === null) return;
      await api(`/api/notes/${note.id}`, {
        method: 'PUT',
        body: JSON.stringify({ title, content })
      });
      renderNotes();
    };
    el.querySelector('[data-action="delete"]').onclick = async () => {
      if (!confirm('Delete note?')) return;
      await api(`/api/notes/${note.id}`, { method: 'DELETE' });
      renderNotes();
    };
    container.appendChild(el);
  }
}

async function renderTasks() {
  const container = document.getElementById('tasks-list');
  const { tasks } = await api('/api/tasks');
  container.innerHTML = '';
  for (const task of tasks) {
    const row = document.createElement('div');
    row.className = 'card task';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = !!task.completed;
    checkbox.onchange = async () => {
      await api(`/api/tasks/${task.id}`, {
        method: 'PUT',
        body: JSON.stringify({ completed: checkbox.checked })
      });
    };
    const title = document.createElement('div');
    title.textContent = task.title;
    title.style.flex = '1';
    const actions = document.createElement('div');
    actions.className = 'task-actions';
    const edit = document.createElement('button');
    edit.textContent = 'Edit';
    edit.onclick = async () => {
      const t = prompt('Task', task.title);
      if (t === null) return;
      await api(`/api/tasks/${task.id}`, {
        method: 'PUT',
        body: JSON.stringify({ title: t })
      });
      renderTasks();
    };
    const del = document.createElement('button');
    del.textContent = 'Delete';
    del.className = 'secondary';
    del.onclick = async () => {
      if (!confirm('Delete task?')) return;
      await api(`/api/tasks/${task.id}`, { method: 'DELETE' });
      renderTasks();
    };
    actions.append(edit, del);
    row.append(checkbox, title, actions);
    container.appendChild(row);
  }
}

function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

document.getElementById('note-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = document.getElementById('note-title').value.trim();
  const content = document.getElementById('note-content').value.trim();
  if (!title || !content) return;
  await api('/api/notes', { method: 'POST', body: JSON.stringify({ title, content }) });
  document.getElementById('note-title').value = '';
  document.getElementById('note-content').value = '';
  renderNotes();
});

document.getElementById('task-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = document.getElementById('task-title').value.trim();
  if (!title) return;
  await api('/api/tasks', { method: 'POST', body: JSON.stringify({ title }) });
  document.getElementById('task-title').value = '';
  renderTasks();
});

document.getElementById('signout')?.addEventListener('click', async () => {
  await api('/api/auth/signout', { method: 'POST' });
  window.location.href = '/signin';
});

// Initialize
loadMe().then(() => { renderNotes(); renderTasks(); });

