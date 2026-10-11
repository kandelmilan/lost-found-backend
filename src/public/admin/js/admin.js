/* Admin website behaviour. Kept in a file (not inline) because the Content-Security-Policy blocks inline scripts. */
(function () {
  const DESKTOP = window.matchMedia('(min-width: 992px)');
  const STORAGE_KEY = 'lf.admin.sidebarCollapsed';

  function safeGet(key) {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function safeSet(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      /* private mode etc. */
    }
  }

  // ---------- Sidebar: collapse on desktop, slide-in on mobile ----------
  if (safeGet(STORAGE_KEY) === '1') document.body.classList.add('sidebar-collapsed');

  document.querySelectorAll('[data-action="toggle-sidebar"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (DESKTOP.matches) {
        const collapsed = document.body.classList.toggle('sidebar-collapsed');
        safeSet(STORAGE_KEY, collapsed ? '1' : '0');
      } else {
        window.bootstrap.Offcanvas.getOrCreateInstance(document.getElementById('sidebar')).toggle();
      }
    });
  });

  // ---------- Print ----------
  document.querySelectorAll('[data-action="print"]').forEach((btn) => {
    btn.addEventListener('click', () => window.print());
  });

  // ---------- Selects that submit their form on change (rows per page) ----------
  document.querySelectorAll('[data-autosubmit]').forEach((el) => {
    el.addEventListener('change', () => el.form.submit());
  });

  // ---------- Confirm before submitting dangerous forms ----------
  document.querySelectorAll('form[data-confirm]').forEach((form) => {
    form.addEventListener('submit', (e) => {
      if (!window.confirm(form.dataset.confirm)) e.preventDefault();
    });
  });

  // ---------- Chat: start at the newest message ----------
  document.querySelectorAll('[data-scroll-bottom]').forEach((el) => {
    el.scrollTop = el.scrollHeight;
  });

  // ---------- Meeting time: show in the admin's local time, send as UTC ISO ----------
  document.querySelectorAll('form[data-local-datetime]').forEach((form) => {
    const local = form.querySelector('input[type="datetime-local"]');
    const hidden = form.querySelector('input[name="at"]');
    const pad = (n) => String(n).padStart(2, '0');
    if (local.dataset.iso) {
      const d = new Date(local.dataset.iso);
      local.value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }
    form.addEventListener('submit', () => {
      hidden.value = local.value ? new Date(local.value).toISOString() : '';
    });
  });

  // ---------- Live chat on a claim page (polls every 3 s, sends without reloading) ----------
  const chatLog = document.querySelector('[data-live-chat]');
  if (chatLog) {
    const url = chatLog.dataset.liveChat;
    const form = document.querySelector('[data-chat-form]');
    const indicator = document.querySelector('[data-live-indicator]');
    const csrf = form ? form.querySelector('input[name="_csrf"]').value : null;
    let lastId = Number(chatLog.dataset.lastId) || 0;
    let busy = false;

    const pad = (n) => String(n).padStart(2, '0');
    const fmt = (iso) => {
      const d = new Date(iso);
      return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
    };
    const nearBottom = () => chatLog.scrollHeight - chatLog.scrollTop - chatLog.clientHeight < 80;

    // Built with textContent so message text can never become HTML.
    function addMessage(m) {
      if (chatLog.querySelector(`[data-id="${m.id}"]`)) return;
      chatLog.querySelector('p.text-muted')?.remove(); // "No messages yet."
      const row = document.createElement('div');
      row.className = `chat-row${m.is_mine ? ' mine' : ''}`;
      row.dataset.id = m.id;
      const bubble = document.createElement('div');
      bubble.className = 'chat-bubble';
      const body = document.createElement('div');
      body.className = 'white-space-pre text-break';
      body.textContent = m.body;
      const meta = document.createElement('div');
      meta.className = 'chat-meta';
      meta.textContent = `${m.sender} · ${fmt(m.created_at)}`;
      if (m.is_mine) {
        const seen = document.createElement('span');
        seen.className = 'chat-seen';
        seen.textContent = m.read ? ' · seen' : '';
        meta.appendChild(seen);
      }
      bubble.append(body, meta);
      row.appendChild(bubble);
      const stick = nearBottom();
      chatLog.appendChild(row);
      if (stick || m.is_mine) chatLog.scrollTop = chatLog.scrollHeight;
      lastId = Math.max(lastId, m.id);
    }

    function markSeen(upToId) {
      chatLog.querySelectorAll('.chat-row.mine').forEach((row) => {
        const seen = row.querySelector('.chat-seen');
        if (seen && Number(row.dataset.id) <= upToId) seen.textContent = ' · seen';
      });
    }

    // Visible tab: every 3 s. Hidden tab: every ~9 s, and the tab title shows "(n)" for new messages.
    const baseTitle = document.title;
    let unseen = 0;
    let tick = 0;

    async function poll(force = false) {
      tick += 1;
      if (busy || (document.hidden && !force && tick % 3 !== 0)) return;
      busy = true;
      try {
        const res = await fetch(`${url}?after=${lastId}`, { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
        if (res.redirected || !res.ok) throw new Error('offline');
        const data = await res.json();
        const incoming = data.messages.filter((m) => !m.is_mine && !chatLog.querySelector(`[data-id="${m.id}"]`)).length;
        data.messages.forEach(addMessage);
        markSeen(data.last_seen_id);
        indicator?.classList.remove('offline');
        if (document.hidden && incoming) {
          unseen += incoming;
          document.title = `(${unseen}) ${baseTitle}`;
        }
        // The claim changed (accepted, cancelled, completed...) → show the new state.
        if (data.status !== chatLog.dataset.status) window.location.reload();
      } catch {
        indicator?.classList.add('offline');
      } finally {
        busy = false;
      }
    }

    setInterval(poll, 3000);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) return;
      unseen = 0;
      document.title = baseTitle;
      poll(true);
    });

    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = form.querySelector('input[name="body"]');
      const text = input.value.trim();
      if (!text) return;
      const button = form.querySelector('button[type="submit"]');
      button.disabled = true;
      try {
        const res = await fetch(form.action, {
          method: 'POST',
          headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
          credentials: 'same-origin',
          body: new URLSearchParams({ _csrf: csrf, body: text }),
        });
        const data = await res.json().catch(() => ({ ok: false, message: 'Could not send. Refresh the page and try again.' }));
        if (!data.ok) throw new Error(data.message);
        input.value = '';
        addMessage(data.message);
      } catch (err) {
        window.alert(err.message || 'Could not send the message.');
      } finally {
        button.disabled = false;
        input.focus();
      }
    });
  }

  // ---------- Inbox badge: refresh every 15 s on every admin page ----------
  const badges = document.querySelectorAll('[data-inbox-badge]');
  if (badges.length) {
    let known = Number(badges[0].textContent) || 0;
    setInterval(async () => {
      try {
        const res = await fetch('/admin/inbox/count', { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
        if (!res.ok || res.redirected) return;
        const { count } = await res.json();
        badges.forEach((b) => {
          b.textContent = count;
          b.hidden = !count;
        });
        // On the inbox itself, show the new claim / message right away.
        if (count > known && document.querySelector('[data-inbox-page]')) window.location.reload();
        known = count;
      } catch {
        /* offline — try again next time */
      }
    }, 15000);
  }

  // ---------- Post item form ----------
  const itemForm = document.getElementById('item-form');
  if (itemForm) {
    // Secret question is only for "found" items.
    const secretSection = document.getElementById('secret-section');
    const secretInputs = secretSection.querySelectorAll('input');
    const syncType = () => {
      const type = itemForm.querySelector('input[name="type"]:checked')?.value;
      const isFound = type === 'found';
      secretSection.hidden = !isFound;
      secretInputs.forEach((input) => {
        input.disabled = !isFound;
        // When editing, an empty answer means "keep the current one".
        input.required = isFound && !input.hasAttribute('data-keep-optional');
      });
    };
    itemForm.querySelectorAll('input[name="type"]').forEach((r) => r.addEventListener('change', syncType));
    syncType();

    // Photo previews + client-side limits (server checks again).
    const photos = document.getElementById('images');
    const previews = document.getElementById('photo-previews');
    const photoError = document.getElementById('photo-error');
    const existingCount = Number(itemForm.dataset.existingPhotos) || 0;
    const removedCount = () => itemForm.querySelectorAll('input[name="remove_images"]:checked').length;
    const checkPhotos = () => {
      photoError.textContent = '';
      const files = Array.from(photos.files);
      const total = existingCount - removedCount() + files.length;
      if (total > 5) photoError.textContent = `An item can have up to 5 photos (you'd have ${total}).`;
      if (files.some((f) => f.size > 8 * 1024 * 1024)) photoError.textContent = 'Each photo must be 8 MB or smaller.';
      photos.setCustomValidity(photoError.textContent);
    };
    itemForm.querySelectorAll('input[name="remove_images"]').forEach((box) => box.addEventListener('change', checkPhotos));
    photos.addEventListener('change', () => {
      previews.innerHTML = '';
      checkPhotos();
      Array.from(photos.files).slice(0, 5).forEach((file) => {
        const img = document.createElement('img');
        img.alt = file.name;
        img.src = URL.createObjectURL(file);
        previews.appendChild(img);
      });
    });

    // Map picker (Leaflet + OpenStreetMap). Click or drag the pin to set latitude/longitude.
    const mapEl = document.getElementById('map-picker');
    const latInput = document.getElementById('latitude');
    const lngInput = document.getElementById('longitude');
    if (mapEl && window.L) {
      const start = [Number(latInput.value) || 27.7172, Number(lngInput.value) || 85.324]; // Kathmandu
      const map = window.L.map(mapEl).setView(start, 13);
      window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors',
      }).addTo(map);
      const marker = window.L.marker(start, { draggable: true }).addTo(map);

      const setPoint = (latlng) => {
        marker.setLatLng(latlng);
        latInput.value = latlng.lat.toFixed(7);
        lngInput.value = latlng.lng.toFixed(7);
      };
      if (!latInput.value) setPoint({ lat: start[0], lng: start[1] });
      map.on('click', (e) => setPoint(e.latlng));
      marker.on('dragend', () => setPoint(marker.getLatLng()));

      const moveToInputs = () => {
        const lat = Number(latInput.value);
        const lng = Number(lngInput.value);
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          marker.setLatLng([lat, lng]);
          map.panTo([lat, lng]);
        }
      };
      latInput.addEventListener('change', moveToInputs);
      lngInput.addEventListener('change', moveToInputs);
    }
  }
})();
