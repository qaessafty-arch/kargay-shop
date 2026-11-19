/* Public site behaviour: menu, language memory, catalogue search and filters, product photos, enquiry counter.
   The pages work without this file; it only adds convenience. */
(function () {
  'use strict';

  var root = document.documentElement;
  root.classList.remove('no-js');
  root.classList.add('js');
  var prefix = root.getAttribute('data-prefix') || '';

  // ---------- Old shared links (/#tile-05) go to the product page ----------
  var old = location.hash.match(/^#tile-(\d+)$/);
  if (old) {
    location.replace(prefix + '/products/' + Number(old[1]));
    return;
  }

  // ---------- Full-screen menu ----------
  var menu = document.getElementById('menu');
  var openers = document.querySelectorAll('[data-menu-open]');
  var lastFocus = null;

  function setExpanded(value) {
    Array.prototype.forEach.call(openers, function (b) { b.setAttribute('aria-expanded', value ? 'true' : 'false'); });
  }

  function openMenu(event) {
    if (event) event.preventDefault();
    lastFocus = document.activeElement;
    menu.classList.add('is-open');
    document.body.classList.add('no-scroll');
    setExpanded(true);
    var first = menu.querySelector('.menu-close');
    if (first) first.focus();
  }

  function closeMenu(event, keepFocus) {
    if (event) event.preventDefault();
    if (!menu.classList.contains('is-open')) return;
    menu.classList.remove('is-open');
    document.body.classList.remove('no-scroll');
    setExpanded(false);
    if (location.hash === '#menu') history.replaceState(null, '', location.pathname + location.search);
    if (!keepFocus && lastFocus && lastFocus.focus) lastFocus.focus();
  }

  if (menu) {
    Array.prototype.forEach.call(openers, function (b) { b.addEventListener('click', openMenu); });
    menu.querySelector('[data-menu-close]').addEventListener('click', closeMenu);
    menu.addEventListener('click', function (event) {
      var link = event.target.closest('a');
      if (link && !link.hasAttribute('data-menu-close')) closeMenu(null, true);
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') closeMenu();
      // Keep keyboard focus inside the open menu.
      if (event.key === 'Tab' && menu.classList.contains('is-open')) {
        var items = menu.querySelectorAll('a, button');
        var firstItem = items[0];
        var lastItem = items[items.length - 1];
        if (event.shiftKey && document.activeElement === firstItem) { event.preventDefault(); lastItem.focus(); }
        else if (!event.shiftKey && document.activeElement === lastItem) { event.preventDefault(); firstItem.focus(); }
      }
    });
    if (location.hash === '#menu') openMenu();
  }

  // ---------- Header turns solid after scrolling past the top of the hero ----------
  var header = document.querySelector('.site-header.is-overlay');
  if (header) {
    var onScroll = function () { header.classList.toggle('is-scrolled', window.scrollY > 40); };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  // ---------- Remember the chosen language ----------
  document.addEventListener('click', function (event) {
    var link = event.target.closest('[data-set-lang]');
    if (!link) return;
    document.cookie = 'lang=' + link.getAttribute('data-set-lang') + ';path=/;max-age=31536000;samesite=lax';
  });

  // ---------- Images fade in when loaded (grey placeholder until then) ----------
  function markLoaded(img) { img.classList.add('is-loaded'); }
  Array.prototype.forEach.call(document.querySelectorAll('img.fade'), function (img) {
    if (img.complete && img.naturalWidth) markLoaded(img);
    else {
      img.addEventListener('load', function () { markLoaded(img); });
      img.addEventListener('error', function () { markLoaded(img); });
    }
  });

  // ---------- Count WhatsApp enquiries (anonymous; only a number per product) ----------
  document.addEventListener('click', function (event) {
    var link = event.target.closest('[data-enquiry]');
    if (link && navigator.sendBeacon) {
      try { navigator.sendBeacon('/api/public/products/' + encodeURIComponent(link.getAttribute('data-enquiry')) + '/enquiry'); } catch (e) { /* counting is optional */ }
    }
  });

  // ---------- Product page: thumbnails switch the main photo ----------
  var mainLink = document.querySelector('.product-main');
  if (mainLink) {
    var mainImg = mainLink.querySelector('img');
    Array.prototype.forEach.call(document.querySelectorAll('.thumb'), function (thumb) {
      thumb.addEventListener('click', function (event) {
        if (!mainImg || event.ctrlKey || event.metaKey) return;
        event.preventDefault();
        event.stopPropagation();
        mainImg.classList.remove('is-loaded');
        mainImg.srcset = thumb.getAttribute('data-thumb') + ' 830w, ' + thumb.getAttribute('href') + ' 1600w';
        mainImg.src = thumb.getAttribute('href');
        mainLink.href = thumb.getAttribute('href');
        mainLink.setAttribute('data-index', thumb.getAttribute('data-index'));
        Array.prototype.forEach.call(document.querySelectorAll('.thumb'), function (t) { t.classList.toggle('is-on', t === thumb); });
      }, true);
    });
  }

  // ---------- Catalogue: search and filters ----------
  var catalog = document.getElementById('catalog');
  if (!catalog) return;
  var bar = catalog.querySelector('.filters');
  var input = document.getElementById('q');
  if (!bar || !input) return;
  bar.hidden = false;

  var cards = Array.prototype.slice.call(catalog.querySelectorAll('.card'));
  var clearBtn = bar.querySelector('[data-clear]');
  var count = bar.querySelector('.result-count');
  var empty = catalog.querySelector('.empty');
  var chips = Array.prototype.slice.call(bar.querySelectorAll('.chip'));
  var state = { q: '', cat: '', size: '' };

  // Search ignores spaces, letter case, Arabic/Kurdish letter variants and Arabic-Indic digits,
  // so "40x40", "40 × 40" and "٤٠×٤٠" all match.
  function norm(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/[٠-٩]/g, function (d) { return String(d.charCodeAt(0) - 0x0660); })
      .replace(/[۰-۹]/g, function (d) { return String(d.charCodeAt(0) - 0x06F0); })
      .replace(/[يى]/g, 'ی')
      .replace(/ك/g, 'ک')
      .replace(/[ةه]/g, 'ە')
      .replace(/[أإآ]/g, 'ا')
      .replace(/[×✕*]/g, 'x')
      .replace(/^#0*/, '')
      .replace(/\s+/g, '');
  }

  cards.forEach(function (card) { card._text = norm(card.getAttribute('data-search')); });

  function apply(updateUrl) {
    var q = norm(state.q);
    // A number on its own means a product number or a size ("7" finds #007, "40" finds 40 × 40), not any text containing it.
    var numeric = /^\d+$/.test(q);
    var shown = 0;
    cards.forEach(function (card) {
      var matches = !q || (numeric
        ? card.getAttribute('data-code') === q || (card.getAttribute('data-size') || '').split('x').indexOf(q) !== -1
        : card._text.indexOf(q) !== -1);
      var ok = matches &&
        (!state.cat || card.getAttribute('data-cat') === state.cat) &&
        (!state.size || card.getAttribute('data-size') === state.size);
      card.hidden = !ok;
      if (ok) shown++;
    });
    chips.forEach(function (chip) {
      var on = state[chip.getAttribute('data-filter')] === chip.getAttribute('data-value');
      chip.classList.toggle('is-on', on);
      chip.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    if (clearBtn) clearBtn.hidden = !state.q;
    if (count) {
      count.textContent = count.getAttribute('data-template')
        .replace('{n}', shown)
        .replace('{total}', count.getAttribute('data-total'));
    }
    if (empty) empty.hidden = shown !== 0;
    if (updateUrl) {
      var params = new URLSearchParams(location.search);
      ['q', 'cat', 'size'].forEach(function (key) {
        if (state[key]) params.set(key, state[key]);
        else params.delete(key);
      });
      var qs = params.toString();
      history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '') + location.hash);
    }
  }

  // Restore filters from the address, so a filtered list can be shared or reloaded.
  var initial = new URLSearchParams(location.search);
  state.q = initial.get('q') || '';
  state.cat = initial.get('cat') || '';
  state.size = initial.get('size') || '';
  input.value = state.q;

  var timer;
  input.addEventListener('input', function () {
    clearTimeout(timer);
    timer = setTimeout(function () { state.q = input.value.trim(); apply(true); }, 120);
  });
  input.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && input.value) { input.value = ''; state.q = ''; apply(true); }
  });
  if (clearBtn) {
    clearBtn.addEventListener('click', function () { input.value = ''; state.q = ''; apply(true); input.focus(); });
  }
  chips.forEach(function (chip) {
    chip.addEventListener('click', function () {
      var key = chip.getAttribute('data-filter');
      var value = chip.getAttribute('data-value');
      state[key] = state[key] === value ? '' : value;
      apply(true);
    });
  });
  var reset = catalog.querySelector('[data-reset]');
  if (reset) {
    reset.addEventListener('click', function () {
      state = { q: '', cat: '', size: '' };
      input.value = '';
      apply(true);
      input.focus();
    });
  }
  apply(false);
})();
