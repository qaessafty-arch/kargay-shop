/* Full-screen photo viewer for links marked data-viewer="<group>".
   Arrows, keyboard, swipe, double-tap or double-click to zoom, pinch and mouse-wheel zoom, drag to pan.
   Without JavaScript the links simply open the full-size photo. */
(function () {
  'use strict';

  var body = document.body;
  var rtl = document.documentElement.dir === 'rtl';
  var labels = {
    close: body.getAttribute('data-t-close') || 'Close',
    prev: body.getAttribute('data-t-prev') || 'Previous',
    next: body.getAttribute('data-t-next') || 'Next',
    viewer: body.getAttribute('data-t-viewer') || 'Photo viewer',
  };
  var MAX_ZOOM = 4;

  var box, stage, img, counter, caption, prevBtn, nextBtn, closeBtn;
  var items = [];
  var index = 0;
  var lastFocus = null;
  var z = { s: 1, x: 0, y: 0, w: 0, h: 0 };

  function el(tag, cls) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    return node;
  }

  function build() {
    box = el('div', 'viewer');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', labels.viewer);
    box.hidden = true;
    stage = el('div', 'viewer-stage');
    img = el('img', 'viewer-img');
    img.alt = '';
    img.draggable = false;
    stage.appendChild(img);
    caption = el('p', 'viewer-caption');
    counter = el('div', 'viewer-count');
    counter.setAttribute('aria-live', 'polite');
    closeBtn = el('button', 'viewer-btn viewer-close');
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', labels.close);
    closeBtn.textContent = '✕';
    prevBtn = el('button', 'viewer-btn viewer-nav viewer-prev');
    prevBtn.type = 'button';
    prevBtn.setAttribute('aria-label', labels.prev);
    prevBtn.textContent = rtl ? '›' : '‹';
    nextBtn = el('button', 'viewer-btn viewer-nav viewer-next');
    nextBtn.type = 'button';
    nextBtn.setAttribute('aria-label', labels.next);
    nextBtn.textContent = rtl ? '‹' : '›';
    [stage, caption, counter, closeBtn, prevBtn, nextBtn].forEach(function (n) { box.appendChild(n); });
    body.appendChild(box);

    closeBtn.addEventListener('click', close);
    prevBtn.addEventListener('click', function () { go(-1); });
    nextBtn.addEventListener('click', function () { go(1); });
    stage.addEventListener('click', function (event) {
      if (event.target === stage && z.s === 1) close();
    });
    img.addEventListener('dblclick', function (event) {
      event.preventDefault();
      toggleZoom(event.clientX, event.clientY);
    });
    stage.addEventListener('wheel', function (event) {
      event.preventDefault();
      zoomAt(event.clientX, event.clientY, z.s * (event.deltaY < 0 ? 1.2 : 1 / 1.2));
    }, { passive: false });
    addMouseDrag();
    addTouch();
    img.addEventListener('load', function () {
      img.classList.add('is-shown');
      measure();
    });
    window.addEventListener('resize', function () { if (!box.hidden) { resetZoom(); measure(); } });
  }

  // ---------- Zoom and pan ----------
  function measure() {
    var prev = img.style.transform;
    img.style.transform = 'none';
    z.w = img.offsetWidth;
    z.h = img.offsetHeight;
    img.style.transform = prev;
  }

  function clamp() {
    var maxX = Math.max(0, (z.w * z.s - stage.clientWidth) / 2);
    var maxY = Math.max(0, (z.h * z.s - stage.clientHeight) / 2);
    z.x = Math.min(maxX, Math.max(-maxX, z.x));
    z.y = Math.min(maxY, Math.max(-maxY, z.y));
  }

  function paint() {
    clamp();
    img.style.transform = 'translate(' + z.x + 'px,' + z.y + 'px) scale(' + z.s + ')';
    box.classList.toggle('is-zoomed', z.s > 1);
  }

  function zoomAt(clientX, clientY, scale) {
    var next = Math.min(MAX_ZOOM, Math.max(1, scale));
    var rect = stage.getBoundingClientRect();
    var px = clientX - (rect.left + rect.width / 2) - z.x;
    var py = clientY - (rect.top + rect.height / 2) - z.y;
    z.x -= px * (next / z.s - 1);
    z.y -= py * (next / z.s - 1);
    z.s = next;
    if (z.s === 1) { z.x = 0; z.y = 0; }
    paint();
  }

  function toggleZoom(x, y) {
    if (z.s > 1) resetZoom();
    else zoomAt(x, y, 2.5);
  }

  function resetZoom() {
    z.s = 1; z.x = 0; z.y = 0;
    paint();
  }

  function addMouseDrag() {
    var dragging = false, sx = 0, sy = 0, ox = 0, oy = 0;
    img.addEventListener('mousedown', function (event) {
      if (z.s === 1) return;
      event.preventDefault();
      dragging = true; sx = event.clientX; sy = event.clientY; ox = z.x; oy = z.y;
    });
    window.addEventListener('mousemove', function (event) {
      if (!dragging) return;
      z.x = ox + event.clientX - sx;
      z.y = oy + event.clientY - sy;
      paint();
    });
    window.addEventListener('mouseup', function () { dragging = false; });
  }

  function addTouch() {
    var start = null, pinch = null, lastTap = 0;
    var dist = function (t) { return Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY); };

    stage.addEventListener('touchstart', function (event) {
      var t = event.touches;
      if (t.length === 2) {
        pinch = { d: dist(t), s: z.s, cx: (t[0].clientX + t[1].clientX) / 2, cy: (t[0].clientY + t[1].clientY) / 2 };
        start = null;
      } else if (t.length === 1) {
        start = { x: t[0].clientX, y: t[0].clientY, ox: z.x, oy: z.y, time: Date.now(), moved: false };
      }
    }, { passive: true });

    stage.addEventListener('touchmove', function (event) {
      var t = event.touches;
      if (pinch && t.length === 2) {
        event.preventDefault();
        zoomAt(pinch.cx, pinch.cy, pinch.s * (dist(t) / pinch.d));
      } else if (start && t.length === 1) {
        var dx = t[0].clientX - start.x;
        var dy = t[0].clientY - start.y;
        if (Math.abs(dx) > 8 || Math.abs(dy) > 8) start.moved = true;
        if (z.s > 1) {
          event.preventDefault();
          z.x = start.ox + dx;
          z.y = start.oy + dy;
          paint();
        }
      }
    }, { passive: false });

    stage.addEventListener('touchend', function (event) {
      if (pinch && event.touches.length < 2) { pinch = null; return; }
      if (!start) return;
      var touch = event.changedTouches[0];
      var dx = touch.clientX - start.x;
      var dy = touch.clientY - start.y;
      if (z.s === 1 && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        // Swipe towards the reading direction moves forward.
        go((dx < 0) !== rtl ? 1 : -1);
      } else if (!start.moved) {
        var now = Date.now();
        if (now - lastTap < 300) {
          toggleZoom(touch.clientX, touch.clientY);
          lastTap = 0;
        } else {
          lastTap = now;
        }
      }
      start = null;
    });
  }

  // ---------- Showing photos ----------
  function render() {
    var item = items[index];
    resetZoom();
    img.classList.remove('is-shown');
    img.src = item.src;
    img.alt = item.caption || '';
    caption.textContent = item.caption || '';
    caption.hidden = !item.caption;
    counter.textContent = (index + 1) + ' / ' + items.length;
    var many = items.length > 1;
    prevBtn.hidden = !many;
    nextBtn.hidden = !many;
    counter.hidden = !many;
    // Load the neighbours in the background so moving between photos feels instant.
    [index + 1, index - 1].forEach(function (i) {
      if (items[(i + items.length) % items.length]) new Image().src = items[(i + items.length) % items.length].src;
    });
  }

  function go(step) {
    if (items.length < 2) return;
    index = (index + step + items.length) % items.length;
    render();
  }

  function open(list, start) {
    if (!box) build();
    items = list;
    index = start;
    lastFocus = document.activeElement;
    box.hidden = false;
    body.classList.add('no-scroll');
    render();
    closeBtn.focus();
  }

  function close() {
    if (!box || box.hidden) return;
    box.hidden = true;
    img.removeAttribute('src');
    body.classList.remove('no-scroll');
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  document.addEventListener('keydown', function (event) {
    if (!box || box.hidden) return;
    if (event.key === 'Escape') close();
    else if (event.key === 'ArrowRight') go(rtl ? -1 : 1);
    else if (event.key === 'ArrowLeft') go(rtl ? 1 : -1);
    else if (event.key === '+' || event.key === '=') zoomAt(innerWidth / 2, innerHeight / 2, z.s * 1.5);
    else if (event.key === '-') zoomAt(innerWidth / 2, innerHeight / 2, z.s / 1.5);
    else if (event.key === 'Tab') {
      // Keep focus inside the viewer.
      var buttons = [closeBtn, prevBtn, nextBtn].filter(function (b) { return !b.hidden; });
      var i = buttons.indexOf(document.activeElement);
      event.preventDefault();
      buttons[(i + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length].focus();
    }
  });

  document.addEventListener('click', function (event) {
    var link = event.target.closest('a[data-viewer]');
    if (!link || event.ctrlKey || event.metaKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    var group = link.getAttribute('data-viewer');
    var seen = {};
    var list = [];
    Array.prototype.forEach.call(document.querySelectorAll('a[data-viewer="' + group + '"]'), function (a) {
      var src = a.getAttribute('href');
      if (!src || src === '#' || seen[src]) return;
      seen[src] = true;
      var img = a.querySelector('img');
      list.push({ src: src, caption: a.getAttribute('data-caption') || (img && img.getAttribute('alt')) || '' });
    });
    if (!list.length) return;
    var at = 0;
    list.forEach(function (item, i) { if (item.src === link.getAttribute('href')) at = i; });
    open(list, at);
  });
})();
