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

  // ---------- First-run setup ----------
  function renderSetup() {
    clear(app);
    var errorBox = el('div');
    var token = el('input', { type: 'password', id: 'setup-token', autocomplete: 'off', required: true, maxlength: 200 });
    var email = el('input', { type: 'email', id: 'setup-email', autocomplete: 'username', required: true, maxlength: 190 });
    var name = el('input', { id: 'setup-name', required: true, maxlength: 80 });
    var password = el('input', { type: 'password', id: 'setup-password', autocomplete: 'new-password', required: true, minlength: 12, maxlength: 128 });
    var submit = el('button', { class: 'primary', type: 'submit', text: 'Create owner account' });
    app.appendChild(el('form', {
      class: 'card login',
      onsubmit: function (event) {
        event.preventDefault();
        submit.disabled = true;
        api('POST', '/api/setup/owner', { token: token.value, email: email.value, displayName: name.value, password: password.value })
          .then(function () {
            token.value = '';
            password.value = '';
            renderLogin();
            notice(app.firstChild, 'Owner account created. Sign in to continue.', 'ok');
          })
          .catch(function (error) { fail(errorBox, error); })
          .then(function () { submit.disabled = false; });
      },
    },
      el('h1', { text: 'Set up your shop' }),
      el('p', { text: 'Create the owner account. You need the one-time setup code you were given.' }),
      errorBox,
      el('label', { for: 'setup-token', text: 'Setup code' }), token,
      el('label', { for: 'setup-email', text: 'Your email' }), email,
      el('label', { for: 'setup-name', text: 'Your name' }), name,
      el('label', { for: 'setup-password', text: 'Password (12+ characters)' }), password,
      el('div', { class: 'actions' }, submit)
    ));
    token.focus();
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
    { id: 'gallery', label: 'Gallery' },
    { id: 'settings', label: 'Settings', owner: true },
    { id: 'users', label: 'Users', owner: true },
    { id: 'audit', label: 'Audit log', owner: true },
    { id: 'account', label: 'My account' },
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
      gallery: renderGallery,
      settings: renderSettings,
      users: renderUsers,
      audit: renderAudit,
      account: renderAccount,
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
  function renderAccount() {
    var main = state.main;
    var current = el('input', { type: 'password', autocomplete: 'current-password', required: true, maxlength: 128 });
    var next = el('input', { type: 'password', autocomplete: 'new-password', required: true, minlength: 12, maxlength: 128 });
    var again = el('input', { type: 'password', autocomplete: 'new-password', required: true, minlength: 12, maxlength: 128 });
    var submit = el('button', { class: 'primary', type: 'submit', text: 'Change password' });
    var box = el('div');
    var form = el('form', {
      class: 'card',
      onsubmit: function (event) {
        event.preventDefault();
        if (next.value !== again.value) return notice(box, 'The two new passwords do not match.');
        submit.disabled = true;
        api('POST', '/api/auth/password', { currentPassword: current.value, newPassword: next.value })
          .then(function () {
            form.reset();
            notice(box, 'Password changed. You were signed out on your other devices.', 'ok');
          })
          .catch(function (error) { fail(box, error); })
          .then(function () { submit.disabled = false; });
      },
    },
      el('h2', { text: 'Change password' }),
      el('label', null, 'Current password', current),
      el('label', null, 'New password (at least 12 characters)', next),
      el('label', null, 'New password again', again),
      submit);
    main.appendChild(el('h1', { text: 'My account' }));
    main.appendChild(el('div', { class: 'card' },
      el('p', null, el('strong', { text: state.user.displayName })),
      el('p', { class: 'muted', text: state.user.email + ' · ' + state.user.role })));
    main.appendChild(box);
    main.appendChild(form);
  }

  function renderDashboard() {
    var main = state.main;
    var grid = el('div', { class: 'grid-stats' });
    var lower = el('div', { class: 'dash-columns' });
    main.appendChild(el('h1', { text: 'Dashboard' }));
    main.appendChild(grid);
    main.appendChild(lower);
    if (state.user.role === 'owner') main.appendChild(importCard());
    api('GET', '/api/admin/stats').then(function (s) {
      var cards = [
        ['Products', s.products], ['Available', s.available], ['Out of stock', s.outOfStock], ['Categories', s.categories],
        ['Visible on site', s.visible], ['Low stock (1–3)', s.lowStock], ['Pending orders', s.pendingOrders],
        ['Revenue this month', money(s.revenueThisMonth)], ['WhatsApp enquiries', s.enquiriesTotal],
      ];
      cards.forEach(function (card) {
        grid.appendChild(el('div', { class: 'card stat' }, el('b', { text: String(card[1]) }), el('span', { text: card[0] })));
      });

      var recent = el('section', { class: 'card' }, el('h2', { text: 'Recently added products' }));
      if (!s.recentProducts.length) recent.appendChild(el('p', { text: 'No products yet.' }));
      s.recentProducts.forEach(function (p) {
        recent.appendChild(el('button', { type: 'button', class: 'list-row', onclick: function () { go('product', p.id); } },
          p.mainImage ? el('img', { class: 'thumb', src: p.mainImage, alt: '' }) : el('span', { class: 'thumb' }),
          el('span', { class: 'list-main' }, el('strong', { text: '#' + p.code + ' ' + p.name }), el('small', { text: when(p.updatedAt) })),
          pill(p.visible ? 'visible' : 'hidden', p.visible ? 'on' : 'off')));
      });
      lower.appendChild(recent);

      if (state.user.role === 'owner') {
        var activity = el('section', { class: 'card' }, el('h2', { text: 'Recent activity' }));
        if (!s.activity.length) activity.appendChild(el('p', { text: 'Nothing yet.' }));
        s.activity.forEach(function (a) {
          activity.appendChild(el('div', { class: 'list-row static' },
            el('span', { class: 'list-main' }, el('strong', { text: a.action + (a.entityId ? ' #' + a.entityId : '') }), el('small', { text: (a.user || 'system') + ' · ' + when(a.at) }))));
        });
        activity.appendChild(el('button', { type: 'button', class: 'small', text: 'Full audit log', onclick: function () { go('audit'); } }));
        lower.appendChild(activity);
      }
    }).catch(function (error) { fail(main, error); });
  }

  function importCard() {
    var card = el('section', { class: 'card' });
    var status = el('p', { text: 'Checking the original products…' });
    card.appendChild(el('h2', { text: 'Original products' }));
    card.appendChild(status);
    api('GET', '/api/admin/import-legacy').then(function (info) {
      if (!info.remaining) {
        status.textContent = 'All ' + info.total + ' original products are in the shop.';
        return;
      }
      status.textContent = info.remaining + ' of ' + info.total + ' original products (with photos) are not imported yet.';
      var button = el('button', { class: 'primary', type: 'button', text: 'Import original products' });
      button.addEventListener('click', function () {
        button.disabled = true;
        var failures = [];
        (function step() {
          api('POST', '/api/admin/import-legacy').then(function (result) {
            failures = failures.concat(result.failed || []);
            status.textContent = 'Importing… ' + result.remaining + ' left.';
            if (result.remaining > 0 && result.imported > 0) return step();
            status.textContent = failures.length
              ? 'Import finished with ' + failures.length + ' problem(s): ' + failures.map(function (f) { return '#' + f.code + ' ' + f.reason; }).join('; ')
              : 'Import finished.';
            button.remove();
          }).catch(function (error) {
            fail(card, error);
            button.disabled = false;
          });
        })();
      });
      card.appendChild(el('div', { class: 'actions' }, button));
    }).catch(function (error) { fail(card, error); });
    return card;
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
      name: el('input', { id: 'name', maxlength: 120, required: true, dir: 'rtl', lang: 'ku' }),
      nameAr: el('input', { id: 'nameAr', maxlength: 120, dir: 'rtl', lang: 'ar' }),
      nameEn: el('input', { id: 'nameEn', maxlength: 120, dir: 'ltr', lang: 'en' }),
      description: el('textarea', { id: 'description', maxlength: 1000, dir: 'rtl', lang: 'ku' }),
      descriptionAr: el('textarea', { id: 'descriptionAr', maxlength: 1000, dir: 'rtl', lang: 'ar' }),
      descriptionEn: el('textarea', { id: 'descriptionEn', maxlength: 1000, dir: 'ltr', lang: 'en' }),
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
        nameAr: fields.nameAr.value.trim(),
        nameEn: fields.nameEn.value.trim(),
        description: fields.description.value,
        descriptionAr: fields.descriptionAr.value,
        descriptionEn: fields.descriptionEn.value,
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
      labelled('Product number', fields.code), labelled('Category', category)));
    form.appendChild(el('h2', { class: 'form-section', text: 'Name and description' }));
    form.appendChild(el('p', { class: 'muted', text: 'Kurdish is required. Arabic and English are shown to visitors who choose those languages; if left empty, the Kurdish text is shown.' }));
    form.appendChild(el('div', { class: 'row three' },
      labelled('Name — Kurdish', fields.name), labelled('Name — Arabic', fields.nameAr), labelled('Name — English', fields.nameEn)));
    form.appendChild(el('div', { class: 'row three' },
      labelled('Description — Kurdish', fields.description), labelled('Description — Arabic', fields.descriptionAr),
      labelled('Description — English', fields.descriptionEn)));
    form.appendChild(el('h2', { class: 'form-section', text: 'Size, price and stock' }));
    form.appendChild(el('div', { class: 'row' },
      labelled('Width (cm)', fields.widthCm), labelled('Height (cm)', fields.heightCm),
      labelled('Price (' + ((state.settings && state.settings.currency) || 'IQD') + ')', fields.price),
      labelled('Stock', fields.stock), labelled('Display order', fields.sort)));
    form.appendChild(el('p', { class: 'muted', text: 'Shown to visitors as: Out of stock when stock is 0; Contact for price when there is no price; otherwise Available. Leave stock empty if you do not track it.' }));
    form.appendChild(el('div', { class: 'row' },
      el('label', { class: 'check' }, fields.visible, 'Visible on the site'),
      el('label', { class: 'check' }, fields.featured, 'Featured (shown first)')));
    var saveButton = el('button', { class: 'primary', type: 'submit', text: 'Save product' });
    var previewLink = el('a', { class: 'button', target: '_blank', rel: 'noopener', text: 'Preview on site', hidden: true });
    form.appendChild(el('div', { class: 'actions' }, saveButton, previewLink,
      el('button', { type: 'button', text: 'Back to products', onclick: function () { go('products'); } })));
    main.appendChild(form);

    if (isNew) {
      api('GET', '/api/admin/products/next-code').then(function (r) { fields.code.placeholder = 'Next free: ' + r.code; }).catch(function () {});
      return;
    }
    api('GET', '/api/admin/products/' + id).then(function (p) {
      fields.code.value = p.code;
      fields.name.value = p.name;
      fields.nameAr.value = p.nameAr || '';
      fields.nameEn.value = p.nameEn || '';
      fields.description.value = p.description;
      fields.descriptionAr.value = p.descriptionAr || '';
      fields.descriptionEn.value = p.descriptionEn || '';
      // Hidden products open with ?preview, which works only for signed-in shop users.
      previewLink.href = '/products/' + p.code + (p.visible ? '' : '?preview');
      previewLink.textContent = p.visible ? 'View on site' : 'Preview (hidden from visitors)';
      previewLink.hidden = false;
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
    panel.appendChild(el('p', { text: 'The first photo is the main one, used on the product card. All photos are shown on the product page. JPEG, PNG or WebP, up to 6 MB each.' }));
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
    var q = el('input', { type: 'search', placeholder: 'Search name, phone or order #', 'aria-label': 'Search orders', maxlength: 100 });
    var results = el('div', { class: 'card table-wrap' });
    var pager = el('div', { class: 'pager' });
    var page = 1;
    var debounce;

    function load() {
      var params = new URLSearchParams({ page: String(page) });
      if (status.value) params.set('status', status.value);
      if (q.value.trim()) params.set('q', q.value.trim());
      clear(results);
      api('GET', '/api/admin/orders?' + params.toString()).then(function (data) {
        clear(results);
        clear(pager);
        if (!data.items.length) results.appendChild(el('p', { text: q.value.trim() || status.value ? 'No matching orders.' : 'No orders yet.' }));
        if (data.pages > 1) {
          pager.appendChild(el('button', { class: 'small', type: 'button', disabled: data.page <= 1, text: 'Previous', onclick: function () { page--; load(); } }));
          pager.appendChild(el('span', { text: 'Page ' + data.page + ' of ' + data.pages }));
          pager.appendChild(el('button', { class: 'small', type: 'button', disabled: data.page >= data.pages, text: 'Next', onclick: function () { page++; load(); } }));
        }
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
    q.addEventListener('input', function () {
      clearTimeout(debounce);
      debounce = setTimeout(function () { page = 1; load(); }, 300);
    });

    main.appendChild(el('h1', { text: 'Orders' }));
    main.appendChild(el('p', { class: 'muted', text: 'Product stock goes down when an order is confirmed or delivered, and comes back if it is cancelled.' }));
    main.appendChild(el('div', { class: 'search' }, q, status,
      el('button', { class: 'primary', type: 'button', text: 'New order', onclick: function () { go('new-order'); } })));
    main.appendChild(results);
    main.appendChild(pager);
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
    var newName = el('input', { maxlength: 60, required: true, dir: 'rtl', 'aria-label': 'Name in Kurdish' });
    var newAr = el('input', { maxlength: 60, dir: 'rtl', 'aria-label': 'Name in Arabic' });
    var newEn = el('input', { maxlength: 60, dir: 'ltr', 'aria-label': 'Name in English' });
    var newSort = el('input', { type: 'number', value: 0, 'aria-label': 'Display order' });
    main.appendChild(notes);
    main.appendChild(el('h1', { text: 'Categories' }));
    main.appendChild(el('p', { class: 'muted', text: 'Categories become the filter buttons in the public showroom. Only categories that have visible products are shown there.' }));
    main.appendChild(el('form', { class: 'card', onsubmit: function (event) {
      event.preventDefault();
      api('POST', '/api/admin/categories', { name: newName.value.trim(), nameAr: newAr.value.trim(), nameEn: newEn.value.trim(), sort: Number(newSort.value || 0) })
        .then(function () { newName.value = ''; newAr.value = ''; newEn.value = ''; notice(notes, 'Category added.', 'ok'); refresh(); })
        .catch(function (error) { fail(notes, error); });
    } }, el('h2', { text: 'New category' }),
      el('div', { class: 'row' }, labelled('Name — Kurdish', newName), labelled('Name — Arabic', newAr), labelled('Name — English', newEn), labelled('Display order', newSort)),
      el('div', { class: 'actions' }, el('button', { class: 'primary', type: 'submit', text: 'Add category' }))));
    main.appendChild(list);

    function refresh() {
      loadCategories().then(function () {
        clear(list);
        if (!state.categories.length) list.appendChild(el('p', { text: 'No categories yet.' }));
        if (state.categories.length) list.appendChild(el('table', null,
          el('thead', null, el('tr', null, ['Kurdish', 'Arabic', 'English', 'Order', 'Products', ''].map(function (h) { return el('th', null, h); }))),
          el('tbody', null, state.categories.map(function (c) {
            var name = el('input', { value: c.name, maxlength: 60, dir: 'rtl', 'aria-label': 'Name in Kurdish' });
            var ar = el('input', { value: c.nameAr || '', maxlength: 60, dir: 'rtl', 'aria-label': 'Name in Arabic' });
            var en = el('input', { value: c.nameEn || '', maxlength: 60, dir: 'ltr', 'aria-label': 'Name in English' });
            var sort = el('input', { type: 'number', value: c.sort, 'aria-label': 'Display order' });
            return el('tr', null,
              el('td', null, name), el('td', null, ar), el('td', null, en), el('td', { class: 'narrow' }, sort),
              el('td', { class: 'num' }, String(c.products || 0)),
              el('td', { class: 'nowrap' },
                el('button', { class: 'small', type: 'button', text: 'Save', onclick: function () {
                  api('PATCH', '/api/admin/categories/' + c.id, { name: name.value.trim(), nameAr: ar.value.trim(), nameEn: en.value.trim(), sort: Number(sort.value || 0) })
                    .then(function () { notice(notes, 'Saved.', 'ok'); refresh(); }).catch(function (error) { fail(notes, error); });
                } }), ' ',
                state.user.role === 'owner' ? el('button', { class: 'small danger', type: 'button', text: 'Delete', onclick: function () {
                  if (!window.confirm('Delete this category? Its products stay, but lose the category.')) return;
                  api('DELETE', '/api/admin/categories/' + c.id).then(function () { refresh(); }).catch(function (error) { fail(notes, error); });
                } }) : null));
          }))));
      }).catch(function (error) { fail(notes, error); });
    }
    refresh();
  }

  // ---------- Gallery ----------
  function renderGallery() {
    var main = state.main;
    var notes = el('div');
    var grid = el('div', { class: 'gallery-admin' });
    var fileInput = el('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', multiple: true, 'aria-label': 'Choose photos' });
    var items = [];

    function paint(list) {
      items = list;
      clear(grid);
      if (!list.length) grid.appendChild(el('p', { text: 'No workshop photos yet. Photos you upload here appear in the Gallery page and the About section.' }));
      list.forEach(function (g, index) {
        var cap = el('input', { value: g.caption || '', maxlength: 200, dir: 'rtl', placeholder: 'Kurdish caption', 'aria-label': 'Caption in Kurdish' });
        var capAr = el('input', { value: g.captionAr || '', maxlength: 200, dir: 'rtl', placeholder: 'Arabic caption', 'aria-label': 'Caption in Arabic' });
        var capEn = el('input', { value: g.captionEn || '', maxlength: 200, dir: 'ltr', placeholder: 'English caption', 'aria-label': 'Caption in English' });
        var featured = el('input', { type: 'checkbox', checked: g.featured });
        grid.appendChild(el('figure', { class: 'image-tile' },
          el('img', { src: g.thumb || g.file, alt: '', loading: 'lazy' }),
          cap, capAr, capEn,
          el('label', { class: 'check' }, featured, 'Featured (used in About)'),
          el('div', { class: 'tools' },
            el('button', { class: 'small', type: 'button', text: '←', 'aria-label': 'Move earlier', disabled: index === 0, onclick: function () { move(index, -1); } }),
            el('button', { class: 'small', type: 'button', text: '→', 'aria-label': 'Move later', disabled: index === list.length - 1, onclick: function () { move(index, 1); } }),
            el('button', { class: 'small primary', type: 'button', text: 'Save', onclick: function () {
              api('PATCH', '/api/admin/gallery/' + g.id, { caption: cap.value.trim(), captionAr: capAr.value.trim(), captionEn: capEn.value.trim(), featured: featured.checked })
                .then(function (r) { paint(r.items); notice(notes, 'Saved.', 'ok'); }).catch(function (error) { fail(notes, error); });
            } }),
            el('button', { class: 'small danger', type: 'button', text: 'Delete', onclick: function () {
              if (!window.confirm('Delete this photo? This cannot be undone.')) return;
              api('DELETE', '/api/admin/gallery/' + g.id).then(function (r) { paint(r.items); notice(notes, 'Photo deleted.', 'ok'); }).catch(function (error) { fail(notes, error); });
            } }))));
      });
    }

    function move(index, step) {
      var ids = items.map(function (i) { return i.id; });
      var moved = ids.splice(index, 1)[0];
      ids.splice(index + step, 0, moved);
      api('PUT', '/api/admin/gallery/order', { ids: ids }).then(function (r) { paint(r.items); }).catch(function (error) { fail(notes, error); });
    }

    var upload = el('button', { class: 'primary', type: 'button', text: 'Upload photos', onclick: function () {
      if (!fileInput.files.length) return notice(notes, 'Choose one or more photos first.', 'error');
      var data = new FormData();
      Array.prototype.forEach.call(fileInput.files, function (f) { data.append('files', f); });
      upload.disabled = true;
      api('POST', '/api/admin/gallery', undefined, data)
        .then(function (r) { fileInput.value = ''; paint(r.items); notice(notes, 'Photos uploaded.', 'ok'); })
        .catch(function (error) { fail(notes, error); })
        .then(function () { upload.disabled = false; });
    } });

    main.appendChild(notes);
    main.appendChild(el('h1', { text: 'Gallery' }));
    main.appendChild(el('p', { class: 'muted', text: 'Workshop and factory photos. Product photos are managed on each product. JPEG, PNG or WebP, up to 6 MB each.' }));
    main.appendChild(el('div', { class: 'card' }, el('div', { class: 'actions' }, fileInput, upload)));
    main.appendChild(el('div', { class: 'card' }, grid));
    api('GET', '/api/admin/gallery').then(function (r) { paint(r.items); }).catch(function (error) { fail(notes, error); });
  }

  // ---------- Settings (owner) ----------
  function renderSettings() {
    var main = state.main;
    var notes = el('div');
    var groups = [
      ['Business', [
        ['shop_name', 'Factory name — Kurdish', 'rtl'], ['shop_name_ar', 'Factory name — Arabic', 'rtl'], ['shop_name_en', 'Factory name — English', 'ltr'],
        ['founded_year', 'Founded year', 'ltr'], ['currency', 'Currency code (e.g. IQD)', 'ltr'],
        ['default_language', 'Default language', 'select'],
      ]],
      ['Contact', [
        ['whatsapp_number', 'WhatsApp number (digits with country code, e.g. 9647504251661)', 'ltr'],
        ['phone_primary', 'Phone (primary)', 'ltr'], ['phone_secondary', 'Phone (secondary)', 'ltr'],
      ]],
      ['Location', [
        ['address', 'Address — Kurdish', 'rtl'], ['address_ar', 'Address — Arabic', 'rtl'], ['address_en', 'Address — English', 'ltr'],
        ['map_url', 'Google Maps link (https://…)', 'ltr'],
        ['map_lat', 'Latitude (optional, shows an embedded map)', 'ltr'], ['map_lng', 'Longitude (optional)', 'ltr'],
      ]],
      ['Social media (leave empty to hide)', [
        ['facebook_url', 'Facebook page link (https://…)', 'ltr'], ['instagram_url', 'Instagram link (https://…)', 'ltr'],
        ['tiktok_handle', 'TikTok handle (e.g. @kargay.barzan.shree)', 'ltr'],
      ]],
      ['Search engines and link previews', [
        ['seo_title_ku', 'Page title — Kurdish', 'rtl'], ['seo_description_ku', 'Description — Kurdish', 'rtl', true],
        ['seo_title_ar', 'Page title — Arabic', 'rtl'], ['seo_description_ar', 'Description — Arabic', 'rtl', true],
        ['seo_title_en', 'Page title — English', 'ltr'], ['seo_description_en', 'Description — English', 'ltr', true],
      ]],
    ];
    var inputs = {};
    var form = el('form', { onsubmit: function (event) {
      event.preventDefault();
      var payload = {};
      Object.keys(inputs).forEach(function (key) { payload[key] = inputs[key].value.trim(); });
      api('PUT', '/api/admin/settings', payload)
        .then(function (saved) { state.settings = saved; notice(notes, 'Settings saved. The public site updates on the next visit.', 'ok'); })
        .catch(function (error) { fail(notes, error); });
    } });
    groups.forEach(function (group) {
      var card = el('section', { class: 'card' }, el('h2', { text: group[0] }));
      // Long text (titles with descriptions) gets two wide columns instead of many narrow ones.
      var row = el('div', { class: group[1].some(function (f) { return f[3]; }) ? 'row two' : 'row' });
      group[1].forEach(function (f) {
        var control;
        if (f[2] === 'select') {
          control = el('select', { id: f[0] }, [['ku', 'Kurdish'], ['ar', 'Arabic'], ['en', 'English']].map(function (o) { return el('option', { value: o[0], text: o[1] }); }));
        } else if (f[3]) {
          control = el('textarea', { id: f[0], maxlength: 300, dir: f[2], rows: 3 });
        } else {
          control = el('input', { id: f[0], maxlength: 300, dir: f[2] });
        }
        inputs[f[0]] = control;
        row.appendChild(labelled(f[1], control));
      });
      card.appendChild(row);
      form.appendChild(card);
    });
    form.appendChild(el('div', { class: 'actions sticky-actions' }, el('button', { class: 'primary', type: 'submit', text: 'Save settings' })));

    function imageCard(kind, title, help) {
      var key = kind === 'logo' ? 'logo_url' : 'hero_url';
      var preview = el('img', { class: 'site-image ' + kind, alt: '' });
      var file = el('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', 'aria-label': 'Choose ' + kind });
      var reset = el('button', { class: 'small', type: 'button', text: 'Use the original', onclick: function () {
        api('DELETE', '/api/admin/settings/images/' + kind).then(function (saved) { show(saved); notice(notes, 'Restored.', 'ok'); }).catch(function (error) { fail(notes, error); });
      } });
      function show(saved) {
        preview.src = saved[key] || (kind === 'logo' ? '/assets/brand-logo.jpg' : '/assets/hero.jpg');
        reset.hidden = !saved[key];
      }
      var up = el('button', { class: 'primary small', type: 'button', text: 'Upload', onclick: function () {
        if (!file.files.length) return notice(notes, 'Choose an image first.', 'error');
        var data = new FormData();
        data.append('file', file.files[0]);
        up.disabled = true;
        api('POST', '/api/admin/settings/images/' + kind, undefined, data)
          .then(function (saved) { file.value = ''; show(saved); notice(notes, 'Image updated.', 'ok'); })
          .catch(function (error) { fail(notes, error); })
          .then(function () { up.disabled = false; });
      } });
      return { card: el('section', { class: 'card' }, el('h2', { text: title }), el('p', { class: 'muted', text: help }), preview, el('div', { class: 'actions' }, file, up, reset)), show: show };
    }
    var logo = imageCard('logo', 'Logo', 'Shown in the header, footer and browser tab. A square image works best.');
    var hero = imageCard('hero', 'Main photo', 'The large photo behind the heading on the home page, also used for link previews. A wide workshop photo works best.');

    main.appendChild(notes);
    main.appendChild(el('h1', { text: 'Settings' }));
    main.appendChild(el('div', { class: 'row two' }, logo.card, hero.card));
    main.appendChild(form);
    api('GET', '/api/admin/settings').then(function (saved) {
      Object.keys(inputs).forEach(function (key) { inputs[key].value = saved[key] || ''; });
      logo.show(saved);
      hero.show(saved);
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
    .catch(function () {
      return api('GET', '/api/setup/status')
        .then(function (status) {
          if (status.needsOwner && status.setupEnabled) return renderSetup();
          if (status.needsOwner) return renderLogin('This shop has no account yet. Setup is not enabled on the server.');
          renderLogin();
        })
        .catch(function () { renderLogin(); });
    });
})();
