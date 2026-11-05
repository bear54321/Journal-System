var book = '', page = '', pages = [];
var bookIndexNow = {};
var bookIndexNowCollapsed = {};
var pid_now = 'start';
var level_on = 0;
var editingId = '';
var pagenoSeq = 0;
var saveTimer = null;

var META_FIELDS = [
  ['刊名'], ['報刊名第一字'], ['報刊第一字筆畫'], ['關鍵詞主題'], ['專刊名稱'], ['刊期'], ['出版者'], ['出版地'],
  ['卷號'], ['西元出版日期(完整)'], ['出版年'], ['出版月'], ['出版日'], ['條碼號'], ['語言', '中文'],
  ['典藏單位', '中研院近史所'], ['目錄顯示', '是'], ['數位物件前台開放權限', '是'],
  ['數位物件開放限制', '限登入/IP範圍'], ['前台可否下載', '是'], ['是否製作浮水印', '是']
];
var META_DERIVED = ['出版年', '出版月', '出版日'];

var $ = jQuery;

/* ---------- 影像檢視（滾輪縮放、拖曳平移） ---------- */
var view = { scale: 1, x: 0, y: 0 };

function applyView() {
  $('#viewerImg').css({ width: (view.nw * view.scale) + 'px', height: (view.nh * view.scale) + 'px', left: view.x + 'px', top: view.y + 'px' });
}
function fitView() {
  var img = document.getElementById('viewerImg'), box = document.getElementById('viewer');
  if (!box.clientWidth || !box.clientHeight) { setTimeout(fitView, 200); return; } // 版面還沒算好時稍後再試
  view.nw = img.naturalWidth || 1; view.nh = img.naturalHeight || 1;
  view.scale = Math.min(box.clientWidth / view.nw, box.clientHeight / view.nh);
  view.x = (box.clientWidth - view.nw * view.scale) / 2;
  view.y = (box.clientHeight - view.nh * view.scale) / 2;
  applyView();
}
function zoomAt(factor, cx, cy) {
  var s = Math.min(8, Math.max(0.05, view.scale * factor)), k = s / view.scale;
  view.x = cx - (cx - view.x) * k;
  view.y = cy - (cy - view.y) * k;
  view.scale = s;
  applyView();
}
function initViewer() {
  var box = $('#viewer'), drag = null;
  $('#viewerImg').on('load', fitView);
  box.on('wheel', function (e) {
    e.preventDefault();
    var r = this.getBoundingClientRect();
    zoomAt(e.originalEvent.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - r.left, e.clientY - r.top);
  });
  box.on('mousedown', function (e) { drag = { x: e.clientX - view.x, y: e.clientY - view.y }; box.css('cursor', 'grabbing'); e.preventDefault(); });
  $(document).on('mousemove', function (e) { if (drag) { view.x = e.clientX - drag.x; view.y = e.clientY - drag.y; applyView(); } });
  $(document).on('mouseup', function () { drag = null; box.css('cursor', 'grab'); });
  $('#zoomIn').click(function () { zoomAt(1.25, box.width() / 2, box.height() / 2); });
  $('#zoomOut').click(function () { zoomAt(0.8, box.width() / 2, box.height() / 2); });
  $('#zoomFit').click(fitView);
  $(window).on('resize', fitView);
}

/* ---------- 共用 ---------- */
function post(url, data) {
  return $.ajax({ url: url, method: 'POST', data: data, dataType: 'text' });
}
function parseJSON(s, fallback) {
  try { var v = JSON.parse(s); return v == null ? fallback : v; } catch (e) { return fallback; }
}
function imgUrl(p) { return 'giveimg.php?b=' + encodeURIComponent(book) + '&p=' + encodeURIComponent(p); }
function uuidv4() { return Date.now().toString(16) + '-' + Math.random().toString(16).substring(2, 10); }
function isRoot(pid) { return pid === undefined || pid === '' || pid === 'start' || pid === '0'; }
function shortTitle(s) { s = String(s || ''); return s.length > 10 ? s.substr(0, 9) + '...' : s; }
function showTitle(o) {
  var t = '';
  if (o.column_name) t += o.column_name + ' ';
  if (parseInt(o.if_cm) > 0) t += '(廣告) ';
  t += o.title || '';
  if (o.author) {
    t += '（' + o.author;
    if (o.author_app) t += ' ' + o.author_app;
    t += '）';
  }
  return t;
}
function pagesText(n) {
  if (Array.isArray(n.page_list) && n.page_list.length) return n.page_list.join(', ');
  return n.page1 === n.page2 ? n.page1 : n.page1 + '~' + n.page2;
}

/* ---------- 輸入欄位 ---------- */
function getInput() {
  var r = {};
  $('#textData .input_data').each(function () {
    var c = $(this).attr('c');
    r[c] = c === 'if_cm' ? ($(this).prop('checked') ? 1 : 0) : $(this).val();
  });
  var list = $.trim($('#page_list').val());
  if (list !== '') {
    r.page_list = list.split(/\r?\n/).map($.trim).filter(Boolean);
    r.page1 = ''; r.page2 = '';
  } else {
    r.page_list = '';
    r.page1 = $('#page1').val(); r.page2 = $('#page2').val();
  }
  return r;
}
function setInput(d) {
  $('#textData .input_data').each(function () {
    var c = $(this).attr('c'), v = d[c];
    if (c === 'if_cm') $(this).prop('checked', parseInt(v) > 0);
    else $(this).val(v === undefined ? '' : v);
  });
  if (d.page1 === undefined) {
    showEasyRange(); $('#page1,#page2').val(page);
  } else if (d.page1 === '' && Array.isArray(d.page_list)) {
    $('#page_list').val(d.page_list.join('\n')).removeClass('d-none');
    $('.page_easy').addClass('d-none');
  } else {
    showEasyRange(); $('#page1').val(d.page1); $('#page2').val(d.page2);
  }
}
function showEasyRange() { $('#page_list').val('').addClass('d-none'); $('.page_easy').removeClass('d-none'); }
function resetForm() {
  editingId = '';
  $('.update_tree').addClass('d-none');
  $('.add_tree').removeClass('d-none');
  setInput({});
  showEasyRange();
  $('#page1,#page2').val(page);
}

/* ---------- 儲存 ---------- */
function saveData() {
  if (!book) return;
  post('saveIndex.php', { book: book, tmpData: JSON.stringify(bookIndexNow) }).done(function () {
    $('#saveDataLog').text('ok').stop(true, true).show().fadeOut(1200);
  }).fail(function (x) {
    alert('存檔失敗：' + (x.responseText || x.status));
  });
}

/* ---------- 目錄樹 ---------- */
function drawBookIndexNow() {
  var children = {};
  Object.keys(bookIndexNow).forEach(function (id) {
    var n = bookIndexNow[id], pid = isRoot(n.pid) ? 'start' : n.pid;
    if (!bookIndexNow[pid] && pid !== 'start') pid = 'start'; // 上層不存在的孤兒掛到頂層，才看得到
    (children[pid] = children[pid] || []).push(id);
  });
  Object.keys(children).forEach(function (pid) {
    children[pid].sort(function (a, b) { return (parseInt(bookIndexNow[a].sort) || 0) - (parseInt(bookIndexNow[b].sort) || 0); });
  });

  function build(pid) {
    var frag = document.createDocumentFragment();
    (children[pid] || []).forEach(function (id) {
      var n = bookIndexNow[id], hasKids = !!children[id];
      var g = $('<div class="tree_group">').attr('data-nid', id).toggleClass('collapsed', bookIndexNowCollapsed[id] == 1);
      var node = $('<div class="tree_node">').attr('data-nid', id).toggleClass('tree_node_selected', id === pid_now);
      if (hasKids) node.append('<span class="toggle_icon"></span>');
      node.append($('<span class="tree_text">').text(showTitle(n)));
      node.append($('<span class="tree_pages">').text(pagesText(n)));
      if (id === pid_now) {
        node.append('<span class="tree_ctrl"><span class="tree_go">前往</span><span class="tree_update">修改</span><span class="tree_del">刪除</span></span>');
      }
      g.append(node);
      g.append($('<div class="tree_next">').attr('data-nid', id).append(build(id)));
      frag.appendChild(g[0]);
    });
    return frag;
  }

  $('#done_list').empty().append(build('start'));
  bindSortable();
}

function bindSortable() {
  $('#done_list, .tree_next').sortable({
    items: '> .tree_group', axis: 'y', tolerance: 'pointer', placeholder: 'ui-sortable-placeholder',
    update: function (e, ui) {
      ui.item.parent().children('.tree_group').each(function (i) {
        bookIndexNow[$(this).data('nid')].sort = i + 1;
      });
      saveData();
    }
  });
}

function descendants(id) {
  var out = [id];
  Object.keys(bookIndexNow).forEach(function (k) {
    if (bookIndexNow[k].pid === id) out = out.concat(descendants(k));
  });
  return out;
}
function nextSort(pid) {
  var m = 0;
  Object.keys(bookIndexNow).forEach(function (k) {
    var p = isRoot(bookIndexNow[k].pid) ? 'start' : bookIndexNow[k].pid;
    if (p === pid) m = Math.max(m, parseInt(bookIndexNow[k].sort) || 0);
  });
  return m + 1;
}
function updateAddButton() {
  $('.add_tree').text(level_on && pid_now !== 'start' && bookIndexNow[pid_now]
    ? '新增至「' + shortTitle(bookIndexNow[pid_now].title) + '」底下' : '存檔');
}
function gotoNode(n) {
  var p = n.page1 === '' && Array.isArray(n.page_list) ? n.page_list[0] : n.page1;
  if (p && pages.indexOf(p) > -1) $('#pageSelect').val(p).change();
}

/* ---------- 換期、換頁 ---------- */
function loadBook(name) {
  book = name; pages = []; bookIndexNow = {}; bookIndexNowCollapsed = {}; pid_now = 'start';
  $('#done_list').empty(); resetForm(); $('#updatePageno').text('');
  if (!book) { page = ''; $('#pageSelect').empty().hide(); $('#viewerImg').removeAttr('src'); $('#page_work').text('').removeAttr('href'); return; }
  $('#page_work').attr('href', 'page_work/index.php?no=' + encodeURIComponent(book)).text('修改頁碼');
  var myBook = book;
  $.when(post('givePageNum.php', { book: book }), post('giveData.php', { book: book })).done(function (a, b) {
    if (myBook !== book) return; // 回應回來前已經換期
    pages = parseJSON(a[0], []).map(String);
    bookIndexNow = parseJSON(b[0], {});
    if (Array.isArray(bookIndexNow)) bookIndexNow = {};
    var sel = $('#pageSelect').empty();
    pages.forEach(function (p) { sel.append($('<option>').val(p).text(p)); });
    sel.toggle(pages.length > 0);
    drawBookIndexNow(); updateAddButton();
    if (pages.length) sel.change();
  }).fail(function () { alert('讀取期刊資料失敗'); });
}

function onPageChange() {
  page = $('#pageSelect').val() || '';
  if (!page) return;
  if ($.trim($('#textarea').val()) === '') $('#page1,#page2').val(page);
  else $('#page2').val(page);
  $('#viewerImg').attr('src', imgUrl(page));
  var seq = ++pagenoSeq;
  $('#updatePageno').removeClass('flash-bg');
  post('givePageno.php', { book: book, page: page }).done(function (pno) {
    if (seq !== pagenoSeq) return; // 翻太快時只採用最後一次
    $('#updatePageno').addClass('flash-bg').text(pno === '' ? '無頁碼' : '第 ' + pno + ' 頁');
  });
}
function stepPage(d) {
  var sel = $('#pageSelect'), k = sel.prop('selectedIndex') + d;
  if (k >= 0 && k < pages.length) sel.prop('selectedIndex', k).change();
}

/* ---------- 雜誌編目 ---------- */
function openMeta() {
  if (!book) return;
  post('saveMeta.php', { book: book, action: 'get' }).done(function (data) {
    var m = parseJSON(data, {});
    var t = $('#meta_table').empty();
    META_FIELDS.forEach(function (f) {
      var inp = $('<input type="text" class="maz_meta_input">').attr('c', f[0]).val(m[f[0]] !== undefined ? m[f[0]] : (f[1] || ''));
      if (META_DERIVED.indexOf(f[0]) > -1) inp.prop('disabled', true);
      if (f[0] === '西元出版日期(完整)') inp.attr('id', 'date_setting').attr('placeholder', 'YYYY-MM-DD');
      t.append($('<tr>').append($('<td>').text(f[0]), $('<td>').append(inp)));
    });
    $('#date_setting').on('blur', function () {
      var d = $(this).val().split('-');
      $('.maz_meta_input[c="出版年"]').val(d[0] || '');
      $('.maz_meta_input[c="出版月"]').val(d[1] || '');
      $('.maz_meta_input[c="出版日"]').val(d[2] || '');
    });
    $('.maz_meta_input[c="刊名"]').on('blur', function () {
      var f = $('.maz_meta_input[c="報刊名第一字"]');
      if (!f.val()) f.val($(this).val().charAt(0));
    });
    $('#meta_div,#mask').removeClass('d-none');
    $('#meta_div').draggable({ cancel: 'input,button' });
  });
}
function saveMeta() {
  var o = {};
  $('.maz_meta_input').each(function () { o[$(this).attr('c')] = $(this).val(); });
  post('saveMeta.php', { book: book, meta: JSON.stringify(o) }).done(function () {
    $('#meta_div,#mask').addClass('d-none');
  }).fail(function (x) { alert('存檔失敗：' + (x.responseText || x.status)); });
}

/* ---------- 自訂範圍（選圖視窗） ---------- */
function openPageDialog() {
  if (!book || !pages.length) return;
  post('givePageno.php', { book: book, page: 'all' }).done(function (data) {
    var all = parseJSON(data, {});
    var table = $('<table>');
    pages.forEach(function (p) {
      var pno = all[p] && all[p][3] !== undefined ? all[p][3] : '';
      var left = $('<td>').append(
        $('<input type="checkbox" class="page_div_list_checkbox">'),
        $('<span class="page_div_list_checkbox_no">').attr('data-v', p).data('no', 0), $('<br>'),
        document.createTextNode(p), $('<br>'),
        document.createTextNode('頁碼：' + pno));
      var right = $('<td>').append($('<img class="page_div_list_img">').attr('src', imgUrl(p)));
      table.append($('<tr>').append(left, right));
    });
    var seq = 0;
    $('#page_div_list').empty().append(table).off('click').on('click', '.page_div_list_checkbox', function () {
      var tag = $(this).next();
      if (this.checked) { tag.text('順序 ' + (++seq)).data('no', seq); }
      else { // 取消勾選：後面的順序往前補
        var gone = tag.data('no'); tag.text('').data('no', 0); seq--;
        $('.page_div_list_checkbox_no').each(function () {
          var n = $(this).data('no');
          if (n > gone) { $(this).data('no', n - 1).text('順序 ' + (n - 1)); }
        });
      }
    });
    $('#page_div,#mask').removeClass('d-none');
    $('#page_div').draggable({ cancel: 'button,img' });
  });
}
function savePageDialog() {
  var picked = [];
  $('.page_div_list_checkbox_no').each(function () {
    var n = parseInt($(this).data('no'));
    if (n > 0) picked.push([n, $(this).attr('data-v')]);
  });
  picked.sort(function (a, b) { return a[0] - b[0]; }); // 數字排序，10 不會排在 2 前面
  $('#page_div,#mask').addClass('d-none');
  $('#page_list').val(picked.map(function (x) { return x[1]; }).join('\n')).toggleClass('d-none', !picked.length);
  $('.page_easy').toggleClass('d-none', picked.length > 0);
}

/* ---------- 初始化 ---------- */
$(function () {
  initViewer();
  $('.leftArea').resizable({ handles: 'e', minWidth: 200, stop: fitView });

  $('#bookSelect').change(function () { loadBook($(this).val()); });
  $('#pageSelect').change(onPageChange); // 只綁一次
  $('#goNext').click(function () { stepPage(1); });
  $('#goPrev').click(function () { stepPage(-1); });
  $('#level_on').click(function () { level_on = this.checked ? 1 : 0; updateAddButton(); });

  $('#metaData_maz').click(openMeta);
  $('#meta_close_btn').click(function () { $('#meta_div,#mask').addClass('d-none'); });
  $('#meta_save_btn').click(saveMeta);

  $('#page_setting').click(openPageDialog);
  $('#page_close_btn').click(function () { $('#page_div,#mask').addClass('d-none'); });
  $('#page_save_btn').click(savePageDialog);
  $('#page_reset').click(function () { showEasyRange(); $('#page1').val(page); $('#page2').val(page); });

  $(document).on('click', '.add_tree', function () {
    var d = getInput();
    if ($.trim(d.title) === '') { alert('主要題名不能是空的！'); return; }
    var pid = level_on ? pid_now : 'start';
    d.pid = pid;
    d.sort = nextSort(pid);
    bookIndexNow[uuidv4()] = d;
    drawBookIndexNow(); saveData(); resetForm();
  });
  $(document).on('click', '.update_tree', function () {
    var d = getInput();
    if ($.trim(d.title) === '') { alert('主要題名不能是空的！'); return; }
    var old = bookIndexNow[editingId];
    d.pid = old.pid; d.sort = old.sort;
    bookIndexNow[editingId] = d;
    drawBookIndexNow(); saveData(); resetForm();
  });
  $('#resetData').click(resetForm);

  $(document).on('click', '.tree_node', function () {
    pid_now = $(this).data('nid');
    drawBookIndexNow(); updateAddButton();
  });
  $(document).on('click', '.toggle_icon', function (e) {
    e.stopPropagation();
    var nid = $(this).closest('.tree_node').data('nid');
    bookIndexNowCollapsed[nid] = bookIndexNowCollapsed[nid] ? 0 : 1;
    $(this).closest('.tree_group').toggleClass('collapsed');
  });
  $(document).on('click', '.tree_go', function (e) { e.stopPropagation(); gotoNode(bookIndexNow[pid_now]); });
  $(document).on('click', '.tree_update', function (e) {
    e.stopPropagation();
    var n = bookIndexNow[pid_now];
    gotoNode(n);
    setInput(n);
    editingId = pid_now;
    $('.update_tree').removeClass('d-none');
    $('.add_tree').addClass('d-none');
  });
  $(document).on('click', '.tree_del', function (e) {
    e.stopPropagation();
    var ids = descendants(pid_now);
    if (!confirm('確定刪除「' + shortTitle(bookIndexNow[pid_now].title) + '」' + (ids.length > 1 ? '及其底下 ' + (ids.length - 1) + ' 筆子篇目' : '') + '？')) return;
    ids.forEach(function (id) { delete bookIndexNow[id]; delete bookIndexNowCollapsed[id]; });
    pid_now = 'start';
    drawBookIndexNow(); updateAddButton(); saveData();
  });

  var h = decodeURIComponent(location.hash.replace('#', ''));
  if (h && $('#bookSelect option').filter(function () { return this.value === h; }).length) {
    $('#bookSelect').val(h).change();
  }
});
