/* Shop admin. All DOM is built with el() and textContent, so stored text is never parsed as HTML. */
(function () {
  'use strict';

  var app = document.getElementById('app');
  var state = { user: null, csrf: null, settings: null, categories: [], view: 'dashboard', main: null };

  // ---------- DOM helpers ----------
  function el(tag, props) {
    var node = document.createElement(tag);
    var attrs = props || {};
    Object.keys(attrs).forEach(function (key) {
      var value = attrs[key];
      if (value === null || value === undefined || value === false) return;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = String(value);
      else if (key.indexOf('on') === 0 && typeof value === 'function') node.addEventListener(key.slice(2), value);
      else if (key === 'value') node.value = String(value);
      else if (value === true) node.setAttribute(key, '');
      else node.setAttribute(key, String(value));
    });
    for (var i = 2; i < arguments.length; i++) {
      appendChildren(node, arguments[i]);
    }
    return node;
  }

  function appendChildren(node, child) {
    if (child === null || child === undefined || child === false) return;
    if (Array.isArray(child)) return child.forEach(function (c) { appendChildren(node, c); });
    node.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function notice(container, message, kind) {
    var box = el('div', { class: 'notice ' + (kind || 'error'), role: kind === 'ok' ? 'status' : 'alert', text: message });
    container.insertBefore(box, container.firstChild);
    setTimeout(function () { if (box.parentNode) box.parentNode.removeChild(box); }, kind === 'ok' ? 3500 : 9000);
  }

  function money(value) {
    if (value === null || value === undefined) return '—';
    var currency = (state.settings && state.settings.currency) || 'IQD';
    return Number(value).toLocaleString('en-US') + ' ' + currency;
  }

  function when(ms) {
    return ms ? new Date(ms).toLocaleString() : '—';
  }

  function pill(text, kind) {
    return el('span', { class: 'pill ' + (kind || ''), text: text });
  }

  // ---------- API ----------
  function ApiError(message, status) {
    this.message = message;
    this.status = status;
  }
  ApiError.prototype = Object.create(Error.prototype);

  function api(method, url, body, formData) {
    var options = { method: method, credentials: 'same-origin', headers: {} };
    if (method !== 'GET') options.headers['X-CSRF-Token'] = state.csrf || '';
    if (formData) {
      options.body = formData;
    } else if (body !== undefined) {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }
    return fetch(url, options).then(function (res) {
      if (res.status === 401 && url.indexOf('/api/auth/') !== 0) {
        state.user = null;
        state.csrf = null;
        renderLogin('Your session has ended. Please sign in again.');
        throw new ApiError('Signed out', 401);
      }
      if (res.status === 204) return null;
      return res.json().catch(function () { return null; }).then(function (data) {
        if (!res.ok) throw new ApiError((data && data.error) || 'Request failed (' + res.status + ').', res.status);
        return data;
      });
    });
  }

  function fail(container, error) {
    if (error && error.status === 401) return;
    notice(container, error && error.message ? error.message : 'Something went wrong.', 'error');
  }

  // ---------- Login ----------
  function renderLogin(message) {
    clear(app);
    var errorBox = el('div');
    var email = el('input', { type: 'email', id: 'email', autocomplete: 'username', required: true, maxlength: 190 });
    var password = el('input', { type: 'password', id: 'password', autocomplete: 'current-password', required: true, maxlength: 128 });
    var submit = el('button', { class: 'primary', type: 'submit', text: 'Sign in' });
    var form = el('form', {
      class: 'card login',
      onsubmit: function (event) {
        event.preventDefault();
        submit.disabled = true;
        api('POST', '/api/auth/login', { email: email.value, password: password.value })
          .then(function (data) {
            state.user = data.user;
            state.csrf = data.csrfToken;
            password.value = '';
            return loadSettings().then(renderShell);
          })
          .catch(function (error) { fail(errorBox, error); })
          .then(function () { submit.disabled = false; });
      },
    },
      el('h1', { text: 'Shop admin' }),
      el('p', { text: 'Sign in with your staff account.' }),
      errorBox,
      message ? el('div', { class: 'notice error', text: message }) : null,
      el('label', { for: 'email', text: 'Email' }), email,
      el('label', { for: 'password', text: 'Password' }), password,
      el('div', { class: 'actions' }, submit)
    );
    app.appendChild(form);
    email.focus();
  }

  function loadSettings() {
    return api('GET', '/api/admin/settings').then(function (settings) { state.settings = settings; });
  }

  function loadCategories() {
    return api('GET', '/api/admin/categories').then(function (data) { state.categories = data.items; });
  }

  // ---------- Shell ----------
  var TABS = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'products', label: 'Products' },
    { id: 'orders', label: 'Orders' },
    { id: 'categories', label: 'Categories' },
    { id: 'settings', label: 'Settings', owner: true },
    { id: 'users', label: 'Users', owner: true },
    { id: 'audit', label: 'Audit log', owner: true },
  ];

  function renderShell() {
    clear(app);
    var isOwner = state.user.role === 'owner';
    var tabs = el('nav', { class: 'tabs', 'aria-label': 'Admin sections' });
    TABS.forEach(function (tab) {
      if (tab.owner && !isOwner) return;
      tabs.appendChild(el('button', {
        type: 'button',
        'aria-current': state.view === tab.id ? 'page' : null,
        onclick: function () { go(tab.id); },
        text: tab.label,
      }));
    });
    tabs.appendChild(el('a', { class: 'button small', href: '/', target: '_blank', rel: 'noopener', style: 'margin:auto 0 auto auto', text: 'View site' }));

    var logout = el('button', { type: 'button', class: 'small', text: 'Sign out', onclick: signOut });
    var top = el('header', { class: 'topbar' },
      el('span', { class: 'brand', text: 'Shop admin' }),
      el('span', { class: 'who' }, state.user.displayName + ' · ' + state.user.role + ' · ', logout)
    );
    state.main = el('main', { id: 'main' });
    app.appendChild(top);
    app.appendChild(tabs);
    app.appendChild(state.main);
    go(state.view);
  }

  function go(view, arg) {
    state.view = view;
    var nav = app.querySelector('.tabs');
    if (nav) {
      Array.prototype.forEach.call(nav.querySelectorAll('button'), function (b) {
        b.setAttribute('aria-current', b.textContent === labelFor(view) ? 'page' : 'false');
        if (b.getAttribute('aria-current') === 'false') b.removeAttribute('aria-current');
      });
    }
    var renderers = {
      dashboard: renderDashboard,
      products: renderProducts,
      product: renderProductEditor,
      orders: renderOrders,
      order: renderOrderDetail,
      'new-order': renderOrderForm,
      categories: renderCategories,
      settings: renderSettings,
      users: renderUsers,
      audit: renderAudit,
    };
    clear(state.main);
    (renderers[view] || renderDashboard)(arg);
  }

  function labelFor(view) {
    var tab = TABS.filter(function (t) { return t.id === view; })[0];
    if (tab) return tab.label;
    if (view === 'product') return 'Products';
    if (view === 'order' || view === 'new-order') return 'Orders';
    return '';
  }

  function signOut() {
    api('POST', '/api/auth/logout').catch(function () {}).then(function () {
      state.user = null;
      state.csrf = null;
      renderLogin('You have signed out.');
    });
  }

  // ---------- Dashboard ----------
  function renderDashboard() {
    var main = state.main;
    var grid = el('div', { class: 'grid-stats' });
    main.appendChild(el('h1', { text: 'Dashboard' }));
    main.appendChild(grid);
    api('GET', '/api/admin/stats').then(function (s) {
      var cards = [
        ['Products', s.products], ['Visible on site', s.visible], ['Featured', s.featured],
        ['Low stock (≤ 3)', s.lowStock], ['Pending orders', s.pendingOrders],
        ['Delivered this month', s.deliveredThisMonth], ['Revenue this month', money(s.revenueThisMonth)],
        ['WhatsApp enquiries', s.enquiriesTotal],
      ];
      cards.forEach(function (card) {
        grid.appendChild(el('div', { class: 'card stat' }, el('b', { text: String(card[1]) }), el('span', { text: card[0] })));
      });
    }).catch(function (error) { fail(main, error); });
  }

  // ---------- Products ----------
  function renderProducts() {
    var main = state.main;
    var q = el('input', { type: 'search', placeholder: 'Search name, description or code', 'aria-label': 'Search products', maxlength: 100 });
    var status = el('select', { 'aria-label': 'Filter by status' },
      [['all', 'All'], ['visible', 'Visible'], ['hidden', 'Hidden'], ['low-stock', 'Low stock'], ['deleted', 'Deleted']]
        .map(function (o) { return el('option', { value: o[0], text: o[1] }); }));
    var category = el('select', { 'aria-label': 'Filter by category' }, el('option', { value: '', text: 'All categories' }));
    state.categories.forEach(function (c) { category.appendChild(el('option', { value: c.id, text: c.name })); });
    var results = el('div', { class: 'card table-wrap' });
    var pager = el('div', { class: 'pager' });
    var page = 1;

    function load() {
      var params = new URLSearchParams({ q: q.value, status: status.value, page: String(page) });
      if (category.value) params.set('category', category.value);
      clear(results);
      results.appendChild(el('p', { text: 'Loading…' }));
      api('GET', '/api/admin/products?' + params.toString()).then(function (data) {
        clear(results);
        if (!data.items.length) {
          results.appendChild(el('p', { text: 'No products match these filters.' }));
        }
        var rows = data.items.map(function (p) {
          var size = p.widthCm && p.heightCm ? p.widthCm + ' × ' + p.heightCm : '—';
          return el('tr', null,
            el('td', null, p.mainImage ? el('img', { class: 'thumb', src: p.mainImage, alt: '', loading: 'lazy' }) : el('span', { class: 'pill', text: 'no photo' })),
            el('td', { class: 'num' }, String(p.code)),
            el('td', null, p.name, p.deleted ? pill('deleted', 'off') : null),
            el('td', null, p.categoryName || '—'),
            el('td', null, size),
            el('td', { class: 'num' }, money(p.price)),
            el('td', { class: 'num' }, p.stock === null ? '—' : String(p.stock), p.stock !== null && p.stock <= 3 ? pill('low', 'warn') : null),
            el('td', null, pill(p.visible ? 'visible' : 'hidden', p.visible ? 'on' : 'off')),
            el('td', { class: 'num' }, String(p.enquiryCount)),
            el('td', null, el('button', { class: 'small', type: 'button', text: 'Edit', onclick: function () { go('product', p.id); } }))
          );
        });
        if (data.items.length) {
          results.appendChild(el('table', null,
            el('thead', null, el('tr', null,
              ['Photo', 'Code', 'Name', 'Category', 'Size cm', 'Price', 'Stock', 'Status', 'Enquiries', ''].map(function (h) {
                return el('th', null, h);
              }))),
            el('tbody', null, rows)));
        }
        clear(pager);
        pager.appendChild(el('span', { text: data.total + ' products · page ' + data.page + ' of ' + data.pages }));
        pager.appendChild(el('button', { class: 'small', type: 'button', disabled: data.page <= 1, text: 'Previous', onclick: function () { page--; load(); } }));
        pager.appendChild(el('button', { class: 'small', type: 'button', disabled: data.page >= data.pages, text: 'Next', onclick: function () { page++; load(); } }));
      }).catch(function (error) { clear(results); fail(results, error); });
    }

    var debounce = null;
    q.addEventListener('input', function () {
      clearTimeout(debounce);
      debounce = setTimeout(function () { page = 1; load(); }, 300);
    });
    status.addEventListener('change', function () { page = 1; load(); });
    category.addEventListener('change', function () { page = 1; load(); });

    main.appendChild(el('div', { class: 'row', style: 'align-items:end' },
      el('h1', { text: 'Products' })));
    main.appendChild(el('div', { class: 'search' }, q, status, category,
      el('button', { class: 'primary', type: 'button', text: 'New product', onclick: function () { go('product', 'new'); } }),
      el('a', { class: 'button', href: '/api/admin/products.csv', text: 'Export CSV' })));
    main.appendChild(results);
    main.appendChild(pager);
    loadCategories().then(function () {
      clear(category);
      category.appendChild(el('option', { value: '', text: 'All categories' }));
      state.categories.forEach(function (c) { category.appendChild(el('option', { value: c.id, text: c.name })); });
      load();
    }).catch(function (error) { fail(main, error); });
  }

  function categorySelect(selectedId) {
    var select = el('select', { id: 'categoryId' }, el('option', { value: '', text: 'No category' }));
    state.categories.forEach(function (c) {
      select.appendChild(el('option', { value: c.id, text: c.name, selected: c.id === selectedId }));
    });
    return select;
  }

  function renderProductEditor(id) {
    var main = state.main;
    var isNew = id === 'new';
    var notes = el('div');
    main.appendChild(notes);
    main.appendChild(el('h1', { text: isNew ? 'New product' : 'Edit product' }));

    var fields = {
      code: el('input', { id: 'code', type: 'number', min: 1, max: 999999, placeholder: 'Auto' }),
      name: el('input', { id: 'name', maxlength: 120, required: true }),
      description: el('textarea', { id: 'description', maxlength: 1000 }),
      widthCm: el('input', { id: 'widthCm', type: 'number', min: 1, max: 500 }),
      heightCm: el('input', { id: 'heightCm', type: 'number', min: 1, max: 500 }),
      price: el('input', { id: 'price', type: 'number', min: 0, placeholder: 'Ask on WhatsApp' }),
      stock: el('input', { id: 'stock', type: 'number', min: 0, placeholder: 'Not tracked' }),
      sort: el('input', { id: 'sort', type: 'number', value: 0 }),
      visible: el('input', { id: 'visible', type: 'checkbox', checked: true }),
      featured: el('input', { id: 'featured', type: 'checkbox' }),
    };
    var category = categorySelect(null);
    category.id = 'categoryId';

    var form = el('form', { class: 'card', onsubmit: function (event) { event.preventDefault(); save(); } });
    var save = function () {
      var payload = {
        code: fields.code.value === '' ? undefined : Number(fields.code.value),
        name: fields.name.value.trim(),
        description: fields.description.value,
        categoryId: category.value === '' ? null : Number(category.value),
        widthCm: numberOrNull(fields.widthCm.value),
        heightCm: numberOrNull(fields.heightCm.value),
        price: numberOrNull(fields.price.value),
        stock: numberOrNull(fields.stock.value),
        sort: Number(fields.sort.value || 0),
        visible: fields.visible.checked,
        featured: fields.featured.checked,
      };
      var request = isNew
        ? api('POST', '/api/admin/products', payload)
        : api('PATCH', '/api/admin/products/' + id, payload);
      request.then(function (data) {
        notice(notes, 'Saved.', 'ok');
        if (isNew && data && data.id) {
          go('product', data.id);
        }
      }).catch(function (error) { fail(notes, error); });
    };

    form.appendChild(el('div', { class: 'row' },
      labelled('Code', fields.code), labelled('Name', fields.name), labelled('Category', category)));
    form.appendChild(labelled('Description (shown as the photo alt text)', fields.description));
    form.appendChild(el('div', { class: 'row' },
      labelled('Width (cm)', fields.widthCm), labelled('Height (cm)', fields.heightCm),
      labelled('Price (' + ((state.settings && state.settings.currency) || 'IQD') + ')', fields.price),
      labelled('Stock', fields.stock), labelled('Display order', fields.sort)));
    form.appendChild(el('div', { class: 'row' },
      el('label', { class: 'check' }, fields.visible, 'Visible on the site'),
      el('label', { class: 'check' }, fields.featured, 'Featured')));
    var saveButton = el('button', { class: 'primary', type: 'submit', text: 'Save product' });
    form.appendChild(el('div', { class: 'actions' }, saveButton,
      el('button', { type: 'button', text: 'Back to products', onclick: function () { go('products'); } })));
    main.appendChild(form);

    if (isNew) return;
    api('GET', '/api/admin/products/' + id).then(function (p) {
      fields.code.value = p.code;
      fields.name.value = p.name;
      fields.description.value = p.description;
      fields.widthCm.value = p.widthCm ?? '';
      fields.heightCm.value = p.heightCm ?? '';
      fields.price.value = p.price ?? '';
      fields.stock.value = p.stock ?? '';
      fields.sort.value = p.sort;
      fields.visible.checked = p.visible;
      fields.featured.checked = p.featured;
      clear(category);
      category.appendChild(el('option', { value: '', text: 'No category' }));
      state.categories.forEach(function (c) {
        category.appendChild(el('option', { value: c.id, text: c.name, selected: c.id === p.categoryId }));
      });
      main.appendChild(imagesPanel(p, notes));
    }).catch(function (error) { fail(notes, error); });
  }

  function labelled(text, control) {
    return el('div', null, el('label', { text: text }), control);
  }

  function numberOrNull(value) {
    return value === '' || value === null || value === undefined ? null : Number(value);
  }

  function imagesPanel(product, notes) {
    var panel = el('section', { class: 'card' });
    var grid = el('div', { class: 'images' });
    var fileInput = el('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', multiple: true, 'aria-label': 'Choose photos' });

    function paint(images) {
      clear(grid);
      if (!images.length) grid.appendChild(el('p', { text: 'No photos yet. Upload at least one.' }));
      images.forEach(function (img, index) {
        var first = index === 0;
        grid.appendChild(el('figure', { class: 'image-tile' },
          el('img', { src: img.thumb || img.file, alt: 'Product photo ' + (index + 1), loading: 'lazy' }),
          el('div', { class: 'tools' },
            first ? pill('main', 'on') : el('button', { class: 'small', type: 'button', text: 'Make main', onclick: function () { reorder(images, index, 0); } }),
            el('button', { class: 'small danger', type: 'button', text: 'Delete', onclick: function () { removeImage(img); } }))));
      });
      if (images.length > 1) {
        panel.dataset.count = String(images.length);
      }
    }

    function reorder(images, from, to) {
      var ids = images.map(function (i) { return i.id; });
      var moved = ids.splice(from, 1)[0];
      ids.splice(to, 0, moved);
      api('PUT', '/api/admin/products/' + product.id + '/images/order', { ids: ids })
        .then(function (data) { paint(data.images); })
        .catch(function (error) { fail(notes, error); });
    }

    function removeImage(img) {
      if (!window.confirm('Delete this photo? This cannot be undone.')) return;
      api('DELETE', '/api/admin/images/' + img.id)
        .then(function (data) { paint(data.images); notice(notes, 'Photo deleted.', 'ok'); })
        .catch(function (error) { fail(notes, error); });
    }

    var upload = el('button', {
      class: 'primary', type: 'button', text: 'Upload photos',
      onclick: function () {
        if (!fileInput.files.length) return notice(notes, 'Choose one or more photos first.', 'error');
        var data = new FormData();
        Array.prototype.forEach.call(fileInput.files, function (f) { data.append('files', f); });
        upload.disabled = true;
        api('POST', '/api/admin/products/' + product.id + '/images', undefined, data)
          .then(function (result) {
            fileInput.value = '';
            paint(result.images);
            notice(notes, 'Photos uploaded.', 'ok');
          })
          .catch(function (error) { fail(notes, error); })
          .then(function () { upload.disabled = false; });
      },
    });

    panel.appendChild(el('h2', { text: 'Photos' }));
    panel.appendChild(el('p', { text: 'The first photo is the main one. The second is shown in the lightbox. JPEG, PNG or WebP, up to 6 MB each.' }));
    panel.appendChild(grid);
    panel.appendChild(el('div', { class: 'actions' }, fileInput, upload));

    api('GET', '/api/admin/products/' + product.id).then(function (p) { paint(p.images); }).catch(function (error) { fail(notes, error); });
    return panel;
  }

  // ---------- Orders ----------
  function renderOrders() {
    var main = state.main;
    var status = el('select', { 'aria-label': 'Filter by status' },
      [['', 'All statuses'], ['pending', 'Pending'], ['confirmed', 'Confirmed'], ['delivered', 'Delivered'], ['cancelled', 'Cancelled']]
        .map(function (o) { return el('option', { value: o[0], text: o[1] }); }));
    var results = el('div', { class: 'card table-wrap' });
    var page = 1;

    function load() {
      var params = new URLSearchParams({ page: String(page) });
      if (status.value) params.set('status', status.value);
      clear(results);
      api('GET', '/api/admin/orders?' + params.toString()).then(function (data) {
        clear(results);
        if (!data.items.length) results.appendChild(el('p', { text: 'No orders yet.' }));
        if (data.items.length) {
          results.appendChild(el('table', null,
            el('thead', null, el('tr', null, ['#', 'Customer', 'Phone', 'Status', 'Total', 'Created', ''].map(function (h) { return el('th', null, h); }))),
            el('tbody', null, data.items.map(function (o) {
              return el('tr', null,
                el('td', { class: 'num' }, String(o.id)), el('td', null, o.customer_name), el('td', null, o.phone),
                el('td', null, pill(o.status, o.status === 'delivered' ? 'on' : o.status === 'cancelled' ? 'off' : 'warn')),
                el('td', { class: 'num' }, money(o.total)), el('td', null, when(o.created_at)),
                el('td', null, el('button', { class: 'small', type: 'button', text: 'Open', onclick: function () { go('order', o.id); } })));
            }))));
        }
      }).catch(function (error) { fail(results, error); });
    }
    status.addEventListener('change', function () { page = 1; load(); });

    main.appendChild(el('h1', { text: 'Orders' }));
    main.appendChild(el('div', { class: 'search' }, status,
      el('button', { class: 'primary', type: 'button', text: 'New order', onclick: function () { go('new-order'); } })));
    main.appendChild(results);
    load();
  }

  function renderOrderDetail(id) {
    var main = state.main;
    var notes = el('div');
    main.appendChild(notes);
    main.appendChild(el('button', { type: 'button', text: '← Back to orders', onclick: function () { go('orders'); } }));
    api('GET', '/api/admin/orders/' + id).then(function (o) {
      main.appendChild(el('h1', { text: 'Order #' + o.id }));
      main.appendChild(el('div', { class: 'card' },
        el('p', null, el('strong', { text: o.customer_name }), ' · ', o.phone),
        o.address ? el('p', { text: 'Address: ' + o.address }) : null,
        o.note ? el('p', { text: 'Note: ' + o.note }) : null,
        el('p', { text: 'Created ' + when(o.created_at) + ' · Status: ' + o.status }),
        el('table', null,
          el('thead', null, el('tr', null, ['Item', 'Qty', 'Unit price', 'Line total'].map(function (h) { return el('th', null, h); }))),
          el('tbody', null, o.items.map(function (i) {
            return el('tr', null, el('td', null, i.product_name), el('td', { class: 'num' }, String(i.qty)),
              el('td', { class: 'num' }, money(i.unit_price)), el('td', { class: 'num' }, money(i.qty * i.unit_price)));
          }))),
        el('p', { style: 'text-align:end;margin-top:12px', text: 'Total: ' + money(o.total) })
      ));
      var actions = el('div', { class: 'actions' });
      [['confirmed', 'Confirm'], ['delivered', 'Mark delivered'], ['cancelled', 'Cancel order'], ['pending', 'Set pending']].forEach(function (pair) {
        if (pair[0] === o.status) return;
        actions.appendChild(el('button', {
          type: 'button', class: pair[0] === 'cancelled' ? 'danger' : '', text: pair[1],
          onclick: function () {
            api('PATCH', '/api/admin/orders/' + id + '/status', { status: pair[0] })
              .then(function () { go('order', id); })
              .catch(function (error) { fail(notes, error); });
          },
        }));
      });
      main.appendChild(actions);
    }).catch(function (error) { fail(notes, error); });
  }

  function renderOrderForm() {
    var main = state.main;
    var notes = el('div');
    var name = el('input', { maxlength: 120 });
    var phone = el('input', { maxlength: 20, inputmode: 'tel', placeholder: '07xx xxx xxxx' });
    var address = el('input', { maxlength: 300 });
    var note = el('textarea', { maxlength: 500 });
    var rows = el('div');

    function addRow() {
      var nameInput = el('input', { placeholder: 'Product or description', maxlength: 120, 'aria-label': 'Item name' });
      var price = el('input', { type: 'number', min: 0, placeholder: 'Unit price', 'aria-label': 'Unit price' });
      var qty = el('input', { type: 'number', min: 1, value: 1, 'aria-label': 'Quantity' });
      var line = el('div', { class: 'row', style: 'align-items:end' }, labelled('Item', nameInput), labelled('Unit price', price), labelled('Qty', qty),
        el('button', { type: 'button', class: 'danger small', text: 'Remove', onclick: function () { rows.removeChild(line); } }));
      line.itemInputs = { name: nameInput, price: price, qty: qty };
      rows.appendChild(line);
    }

    main.appendChild(notes);
    main.appendChild(el('h1', { text: 'New order' }));
    main.appendChild(el('button', { type: 'button', text: '← Back to orders', onclick: function () { go('orders'); } }));
    main.appendChild(el('form', { class: 'card', onsubmit: function (event) {
      event.preventDefault();
      var items = Array.prototype.map.call(rows.childNodes, function (line) {
        return {
          productName: line.itemInputs.name.value.trim(),
          unitPrice: Number(line.itemInputs.price.value),
          qty: Number(line.itemInputs.qty.value),
        };
      });
      api('POST', '/api/admin/orders', { customerName: name.value.trim(), phone: phone.value.trim(), address: address.value.trim(), note: note.value.trim(), items: items })
        .then(function (data) { go('order', data.id); })
        .catch(function (error) { fail(notes, error); });
    } },
      el('div', { class: 'row' }, labelled('Customer name', name), labelled('Phone', phone), labelled('Address', address)),
      labelled('Note', note),
      el('h2', { text: 'Items' }), rows,
      el('div', { class: 'actions' },
        el('button', { type: 'button', text: 'Add item', onclick: addRow }),
        el('button', { class: 'primary', type: 'submit', text: 'Save order' })),
    ));
    addRow();
  }

  // ---------- Categories ----------
  function renderCategories() {
    var main = state.main;
    var notes = el('div');
    var list = el('div', { class: 'card table-wrap' });
    var newName = el('input', { maxlength: 60, placeholder: 'New category name', 'aria-label': 'New category name' });
    var newSort = el('input', { type: 'number', value: 0, 'aria-label': 'Display order' });
    main.appendChild(notes);
    main.appendChild(el('h1', { text: 'Categories' }));
    main.appendChild(el('form', { class: 'card', onsubmit: function (event) {
      event.preventDefault();
      api('POST', '/api/admin/categories', { name: newName.value.trim(), sort: Number(newSort.value || 0) })
        .then(function () { newName.value = ''; notice(notes, 'Category added.', 'ok'); refresh(); })
        .catch(function (error) { fail(notes, error); });
    } }, el('div', { class: 'row' }, labelled('Name', newName), labelled('Display order', newSort)),
      el('div', { class: 'actions' }, el('button', { class: 'primary', type: 'submit', text: 'Add category' }))));
    main.appendChild(list);

    function refresh() {
      loadCategories().then(function () {
        clear(list);
        if (!state.categories.length) list.appendChild(el('p', { text: 'No categories yet.' }));
        if (state.categories.length) list.appendChild(el('table', null,
          el('thead', null, el('tr', null, ['Name', 'Order', ''].map(function (h) { return el('th', null, h); }))),
          el('tbody', null, state.categories.map(function (c) {
            var name = el('input', { value: c.name, maxlength: 60, 'aria-label': 'Category name' });
            var sort = el('input', { type: 'number', value: c.sort, 'aria-label': 'Display order' });
            return el('tr', null,
              el('td', null, name), el('td', { style: 'width:110px' }, sort),
              el('td', null,
                el('button', { class: 'small', type: 'button', text: 'Save', onclick: function () {
                  api('PATCH', '/api/admin/categories/' + c.id, { name: name.value.trim(), sort: Number(sort.value || 0) })
                    .then(function () { notice(notes, 'Saved.', 'ok'); refresh(); }).catch(function (error) { fail(notes, error); });
                } }), ' ',
                state.user.role === 'owner' ? el('button', { class: 'small danger', type: 'button', text: 'Delete', onclick: function () {
                  if (!window.confirm('Delete this category? Products stay, but lose the category.')) return;
                  api('DELETE', '/api/admin/categories/' + c.id).then(function () { refresh(); }).catch(function (error) { fail(notes, error); });
                } }) : null));
          }))));
      }).catch(function (error) { fail(notes, error); });
    }
    refresh();
  }

  // ---------- Settings (owner) ----------
  function renderSettings() {
    var main = state.main;
    var notes = el('div');
    var fields = [
      ['shop_name', 'Shop name'], ['phone_primary', 'Phone (primary)'], ['phone_secondary', 'Phone (secondary)'],
      ['whatsapp_number', 'WhatsApp number (digits, with country code)'], ['tiktok_handle', 'TikTok handle'],
      ['address', 'Address'], ['founded_year', 'Founded year'], ['currency', 'Currency code'],
    ];
    var inputs = {};
    var form = el('form', { class: 'card', onsubmit: function (event) {
      event.preventDefault();
      var payload = {};
      fields.forEach(function (f) { payload[f[0]] = inputs[f[0]].value.trim(); });
      api('PUT', '/api/admin/settings', payload)
        .then(function (s) { state.settings = s; notice(notes, 'Settings saved. The public site updates on the next visit.', 'ok'); })
        .catch(function (error) { fail(notes, error); });
    } });
    main.appendChild(notes);
    main.appendChild(el('h1', { text: 'Settings' }));
    fields.forEach(function (f) {
      inputs[f[0]] = el('input', { id: f[0], maxlength: 200 });
      form.appendChild(labelled(f[1], inputs[f[0]]));
    });
    form.appendChild(el('div', { class: 'actions' }, el('button', { class: 'primary', type: 'submit', text: 'Save settings' })));
    main.appendChild(form);
    api('GET', '/api/admin/settings').then(function (s) {
      fields.forEach(function (f) { inputs[f[0]].value = s[f[0]] || ''; });
    }).catch(function (error) { fail(notes, error); });
  }

  // ---------- Users (owner) ----------
  function renderUsers() {
    var main = state.main;
    var notes = el('div');
    var list = el('div', { class: 'card table-wrap' });
    var email = el('input', { type: 'email', maxlength: 190 });
    var name = el('input', { maxlength: 80 });
    var role = el('select', null, el('option', { value: 'staff', text: 'Staff' }), el('option', { value: 'owner', text: 'Owner' }));
    var password = el('input', { type: 'password', minlength: 12, maxlength: 128, autocomplete: 'new-password' });

    main.appendChild(notes);
    main.appendChild(el('h1', { text: 'Users' }));
    main.appendChild(el('form', { class: 'card', onsubmit: function (event) {
      event.preventDefault();
      api('POST', '/api/admin/users', { email: email.value.trim(), displayName: name.value.trim(), role: role.value, password: password.value })
        .then(function () { notice(notes, 'User created. Share the password securely.', 'ok'); email.value = ''; name.value = ''; password.value = ''; refresh(); })
        .catch(function (error) { fail(notes, error); });
    } },
      el('h2', { text: 'Add user' }),
      el('div', { class: 'row' }, labelled('Email', email), labelled('Display name', name), labelled('Role', role), labelled('Temporary password (12+ characters)', password)),
      el('div', { class: 'actions' }, el('button', { class: 'primary', type: 'submit', text: 'Create user' }))));
    main.appendChild(list);

    function refresh() {
      api('GET', '/api/admin/users').then(function (data) {
        clear(list);
        list.appendChild(el('table', null,
          el('thead', null, el('tr', null, ['Email', 'Name', 'Role', 'Status', 'Last sign-in', ''].map(function (h) { return el('th', null, h); }))),
          el('tbody', null, data.items.map(function (u) {
            var isSelf = u.id === state.user.id;
            return el('tr', null,
              el('td', null, u.email, isSelf ? pill('you') : null), el('td', null, u.displayName), el('td', null, u.role),
              el('td', null, pill(u.active ? 'active' : 'disabled', u.active ? 'on' : 'off')), el('td', null, when(u.lastLoginAt)),
              el('td', null,
                el('button', { class: 'small', type: 'button', disabled: isSelf && u.active, text: u.active ? 'Disable' : 'Enable', onclick: function () {
                  api('PATCH', '/api/admin/users/' + u.id, { active: !u.active }).then(refresh).catch(function (error) { fail(notes, error); });
                } }), ' ',
                el('button', { class: 'small', type: 'button', text: 'Change role', onclick: function () {
                  api('PATCH', '/api/admin/users/' + u.id, { role: u.role === 'owner' ? 'staff' : 'owner' }).then(refresh).catch(function (error) { fail(notes, error); });
                } }), ' ',
                el('button', { class: 'small', type: 'button', text: 'Reset password', onclick: function () {
                  var next = window.prompt('New password for ' + u.email + ' (12+ characters). All of their sessions will end.');
                  if (!next) return;
                  api('POST', '/api/admin/users/' + u.id + '/password', { password: next })
                    .then(function () { notice(notes, 'Password reset.', 'ok'); })
                    .catch(function (error) { fail(notes, error); });
                } })));
          }))));
      }).catch(function (error) { fail(notes, error); });
    }
    refresh();
  }

  // ---------- Audit (owner) ----------
  function renderAudit() {
    var main = state.main;
    var results = el('div', { class: 'card table-wrap' });
    var page = 1;
    var pager = el('div', { class: 'pager' });

    function load() {
      clear(results);
      api('GET', '/api/admin/audit?page=' + page).then(function (data) {
        clear(results);
        results.appendChild(el('table', null,
          el('thead', null, el('tr', null, ['When', 'Who', 'Action', 'Entity', 'Details'].map(function (h) { return el('th', null, h); }))),
          el('tbody', null, data.items.map(function (row) {
            return el('tr', null, el('td', null, when(row.at)), el('td', null, row.userEmail || 'system'), el('td', null, row.action),
              el('td', null, (row.entity || '') + (row.entityId ? ' #' + row.entityId : '')),
              el('td', null, row.detail ? JSON.stringify(row.detail) : ''));
          }))));
        clear(pager);
        pager.appendChild(el('span', { text: data.total + ' entries · page ' + data.page + ' of ' + data.pages }));
        pager.appendChild(el('button', { class: 'small', type: 'button', disabled: data.page <= 1, text: 'Newer', onclick: function () { page--; load(); } }));
        pager.appendChild(el('button', { class: 'small', type: 'button', disabled: data.page >= data.pages, text: 'Older', onclick: function () { page++; load(); } }));
      }).catch(function (error) { fail(results, error); });
    }

    main.appendChild(el('h1', { text: 'Audit log' }));
    main.appendChild(results);
    main.appendChild(pager);
    load();
  }

  // ---------- Boot ----------
  api('GET', '/api/auth/me')
    .then(function (data) {
      state.user = data.user;
      state.csrf = data.csrfToken;
      return loadSettings().then(renderShell);
    })
    .catch(function () { renderLogin(); });
})();
