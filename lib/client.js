window.__ModuleLoader__.load({
  id: "dsh-furniture-fireload",
  factory: function (require) {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    var react = require("react");
    var h = react.createElement;

    var PANEL_ID = "furniture-fireload";
    var PANEL_ORDER = 26;
    var API = "api/furniture-fireload";
    var NS = "dsh-furniture-fireload";
    var STYLE_ID = "dsh-furniture-fireload/style";

    var MESSAGES = {
      zh: {
        "entry.label": "火灾荷载",
        "entry.hint": "家具材质细化与火灾荷载工作台",
      },
      en: {
        "entry.label": "Fire load",
        "entry.hint": "Furniture material refinement and fire load",
      },
    };

    var BROAD_COLORS = {
      fabric: "#7aa7f5",
      wood: "#c79355",
      plastic: "#8f9db0",
      glass: "#5fc7d8",
      metal: "#9aa0ab",
      foam: "#e0b256",
      leather: "#b07a58",
    };
    var BROAD_LABELS = {
      fabric: "织物",
      wood: "木材",
      plastic: "塑料",
      glass: "玻璃",
      metal: "金属",
      foam: "泡沫填充",
      leather: "皮革",
    };
    var STATUS_LABELS = {
      queued: "排队中",
      running: "运行中",
      succeeded: "已完成",
      failed: "失败",
      cancelled: "已取消",
    };

    var CSS = "" +
      ".ffx-root{display:flex;flex-direction:column;height:100%;min-height:0;background:var(--dsw-alias-bg-module-platform,transparent);color:var(--dsw-alias-label-primary,#111);font-size:13px}" +
      ".ffx-top{display:flex;align-items:center;gap:10px;padding:10px 16px;border-bottom:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.18));flex:0 0 auto}" +
      ".ffx-title{font-size:14px;font-weight:600;letter-spacing:.2px}" +
      ".ffx-sub{font-size:11px;color:var(--dsw-alias-label-tertiary,#888)}" +
      ".ffx-spacer{flex:1 1 auto}" +
      ".ffx-body{flex:1 1 auto;min-height:0;display:grid;grid-template-columns:340px minmax(0,1fr);gap:0}" +
      ".ffx-left{border-right:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.18));overflow:auto;padding:12px 14px 24px;min-height:0}" +
      ".ffx-right{overflow:auto;padding:12px 16px 28px;min-height:0}" +
      ".ffx-sec{display:flex;align-items:center;gap:8px;margin:14px 0 8px;font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary,#555)}" +
      ".ffx-sec:first-child{margin-top:0}" +
      ".ffx-sec .ffx-rule{flex:1 1 auto;height:1px;background:var(--dsw-alias-border-l2,rgba(127,127,127,.16))}" +
      ".ffx-field{display:flex;flex-direction:column;gap:4px;margin-bottom:10px}" +
      ".ffx-label{font-size:11.5px;color:var(--dsw-alias-label-secondary,#666)}" +
      ".ffx-hint{font-size:10.5px;color:var(--dsw-alias-label-tertiary,#999);line-height:1.5}" +
      ".ffx-input,.ffx-select{width:100%;box-sizing:border-box;padding:6px 8px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.28));background:var(--dsw-alias-bg-layer-2,#fff);color:inherit;font-size:12px;font-family:inherit;outline:none}" +
      ".ffx-input:focus,.ffx-select:focus{border-color:var(--dsw-alias-brand-primary,#4b7bec)}" +
      ".ffx-row{display:flex;gap:8px;align-items:flex-end}" +
      ".ffx-row>*{flex:1 1 0;min-width:0}" +
      ".ffx-btn{display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:7px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.3));background:var(--dsw-alias-bg-layer-3,#f6f6f7);color:inherit;font-size:12px;cursor:pointer;font-family:inherit;white-space:nowrap}" +
      ".ffx-btn:hover:not(:disabled){border-color:var(--dsw-alias-brand-primary,#4b7bec)}" +
      ".ffx-btn:disabled{opacity:.5;cursor:not-allowed}" +
      ".ffx-btn-primary{background:var(--dsw-alias-brand-primary,#4b7bec);border-color:transparent;color:#fff;font-weight:600}" +
      ".ffx-btn-primary:hover:not(:disabled){filter:brightness(1.06)}" +
      ".ffx-chip{display:inline-flex;align-items:center;gap:5px;padding:2px 8px;border-radius:999px;font-size:10.5px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.28));color:var(--dsw-alias-label-secondary,#555);background:var(--dsw-alias-bg-layer-2,#fff)}" +
      ".ffx-chip.ok{border-color:rgba(58,168,110,.5);color:#2f855a}" +
      ".ffx-chip.warn{border-color:rgba(214,158,46,.55);color:#a06a12}" +
      ".ffx-chip.err{border-color:rgba(214,80,80,.55);color:#b03a3a}" +
      ".ffx-chip.run{border-color:rgba(75,123,236,.6);color:#3b6fd4}" +
      ".ffx-drop{border:1px dashed var(--dsw-alias-border-l2,rgba(127,127,127,.34));border-radius:9px;padding:10px;display:flex;gap:10px;align-items:center;cursor:pointer;background:var(--dsw-alias-bg-layer-2,#fff)}" +
      ".ffx-drop:hover{border-color:var(--dsw-alias-brand-primary,#4b7bec)}" +
      ".ffx-thumb{width:64px;height:64px;border-radius:7px;object-fit:cover;background:var(--dsw-alias-bg-layer-3,#f0f0f1);flex:0 0 auto}" +
      ".ffx-flow{display:flex;flex-direction:column;gap:10px}" +
      ".ffx-flowrow{display:grid;gap:10px;align-items:stretch}" +
      ".ffx-flowrow.top{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}" +
      ".ffx-flowrow.mid{grid-template-columns:repeat(4,minmax(0,1fr))}" +
      ".ffx-flowrow.low{grid-template-columns:minmax(0,1.15fr) minmax(0,1fr)}" +
      ".ffx-card{border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.2));border-radius:10px;background:var(--dsw-alias-bg-layer-2,#fff);padding:10px 12px;display:flex;flex-direction:column;gap:6px;min-width:0}" +
      ".ffx-card.hero{border-width:1.5px;border-color:var(--dsw-alias-brand-primary,#4b7bec);background:linear-gradient(180deg,rgba(75,123,236,.10),transparent 70%)}" +
      ".ffx-card.ghost{border-style:dashed;color:var(--dsw-alias-label-tertiary,#999)}" +
      ".ffx-card-t{display:flex;align-items:center;gap:6px;font-size:11.5px;font-weight:600;color:var(--dsw-alias-label-secondary,#555)}" +
      ".ffx-card-t .ffx-num{width:15px;height:15px;border-radius:4px;background:var(--dsw-alias-bg-layer-3,#eee);display:inline-flex;align-items:center;justify-content:center;font-size:9.5px;color:var(--dsw-alias-label-tertiary,#888)}" +
      ".ffx-val{font-size:19px;font-weight:650;letter-spacing:.2px;font-variant-numeric:tabular-nums;line-height:1.15}" +
      ".ffx-val small{font-size:11px;font-weight:500;color:var(--dsw-alias-label-tertiary,#888);margin-left:3px}" +
      ".ffx-hero-val{font-size:30px;font-weight:700;color:var(--dsw-alias-brand-primary,#3b6fd4);font-variant-numeric:tabular-nums;line-height:1.1}" +
      ".ffx-note{font-size:10.5px;color:var(--dsw-alias-label-tertiary,#8a8a8a);line-height:1.5}" +
      ".ffx-bars{display:flex;flex-direction:column;gap:4px}" +
      ".ffx-bar{display:grid;grid-template-columns:56px minmax(0,1fr) 42px;gap:6px;align-items:center;font-size:10.5px}" +
      ".ffx-bar-name{color:var(--dsw-alias-label-secondary,#666);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      ".ffx-bar-track{height:7px;border-radius:4px;background:var(--dsw-alias-bg-layer-3,#ececee);overflow:hidden}" +
      ".ffx-bar-fill{height:100%;border-radius:4px}" +
      ".ffx-bar-val{text-align:right;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-tertiary,#888)}" +
      ".ffx-table{width:100%;border-collapse:collapse;font-size:11px;font-variant-numeric:tabular-nums}" +
      ".ffx-table th{text-align:left;font-weight:600;color:var(--dsw-alias-label-tertiary,#8a8a8a);padding:3px 6px;border-bottom:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.18));font-size:10.5px;white-space:nowrap}" +
      ".ffx-table td{padding:3px 6px;border-bottom:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.09))}" +
      ".ffx-table tr:last-child td{border-bottom:none}" +
      ".ffx-num-cell{text-align:right}" +
      ".ffx-more{display:inline-flex;align-items:center;gap:4px;margin-top:6px;padding:2px 8px;border-radius:6px;border:1px dashed var(--dsw-alias-border-l2,rgba(127,127,127,.34));background:transparent;color:var(--dsw-alias-label-tertiary,#8a8a8a);font-size:10.5px;line-height:1.5;cursor:pointer}" +
      ".ffx-more:hover{color:var(--dsw-alias-label-primary,#333);border-color:var(--dsw-alias-border-l2,rgba(127,127,127,.6))}" +
      ".ffx-fold-hint{margin-top:4px;font-size:10.5px;color:var(--dsw-alias-label-dimmed,#aaa)}" +
      ".ffx-log{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:10.5px;line-height:1.65;max-height:190px;overflow:auto;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.18));border-radius:8px;padding:6px 8px;background:var(--dsw-alias-bg-layer-2,#fff)}" +
      ".ffx-log-line{display:flex;gap:6px;white-space:pre-wrap;word-break:break-word}" +
      ".ffx-log-time{color:var(--dsw-alias-label-dimmed,#aaa);flex:0 0 auto}" +
      ".ffx-log-stage{color:var(--dsw-alias-label-tertiary,#999);flex:0 0 auto;min-width:58px}" +
      ".ffx-log.warn .ffx-log-line.is-warn{color:#a06a12}" +
      ".ffx-log-line.is-error{color:#b03a3a}" +
      ".ffx-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}" +
      ".ffx-muted{color:var(--dsw-alias-label-tertiary,#999)}" +
      ".ffx-link{color:var(--dsw-alias-brand-primary,#3b6fd4);text-decoration:none;font-size:11px}" +
      ".ffx-link:hover{text-decoration:underline}" +
      ".ffx-artifacts{display:flex;flex-wrap:wrap;gap:8px}" +
      ".ffx-empty{padding:26px 10px;text-align:center;color:var(--dsw-alias-label-tertiary,#999);font-size:12px}" +
      ".ffx-overlay{max-width:100%;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.2));display:block}" +
      ".ffx-error{margin-top:8px;padding:8px 10px;border-radius:8px;border:1px solid rgba(214,80,80,.4);background:rgba(214,80,80,.07);color:#b03a3a;font-size:11px;white-space:pre-wrap;word-break:break-word}" +
      ".ffx-toggle{display:flex;align-items:center;gap:7px;font-size:11.5px;color:var(--dsw-alias-label-secondary,#555);cursor:pointer;user-select:none}" +
      ".ffx-toggle input{accent-color:var(--dsw-alias-brand-primary,#4b7bec)}" +
      ".ffx-kv{display:grid;grid-template-columns:auto minmax(0,1fr);gap:2px 10px;font-size:10.5px;color:var(--dsw-alias-label-secondary,#666)}" +
      ".ffx-kv b{font-weight:600;color:var(--dsw-alias-label-tertiary,#8a8a8a)}" +
      ".ffx-duo{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:2px}" +
      ".ffx-duo-cell{padding:7px 9px;border-radius:8px;background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.06));border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.16))}" +
      ".ffx-duo-label{font-size:10px;line-height:1.35;color:var(--dsw-alias-label-tertiary,#8a8a8a)}" +
      ".ffx-duo-value{margin-top:1px;font-size:17px;font-weight:600;color:var(--dsw-alias-label-primary,#111);font-variant-numeric:tabular-nums}" +
      ".ffx-duo-unit{margin-left:3px;font-size:10.5px;font-weight:400;color:var(--dsw-alias-label-tertiary,#8a8a8a)}" +
      ".ffx-tabs{display:inline-flex;padding:2px;border-radius:8px;background:var(--dsw-alias-bg-layer-3,rgba(127,127,127,.1));gap:2px}" +
      ".ffx-tab{border:none;background:transparent;color:var(--dsw-alias-label-tertiary,#8a8a8a);font-size:11.5px;padding:3px 10px;border-radius:6px;cursor:pointer;line-height:1.6}" +
      ".ffx-tab.active{background:var(--dsw-alias-bg-layer-2,#fff);color:var(--dsw-alias-label-primary,#111);font-weight:600;box-shadow:0 1px 2px rgba(0,0,0,.08)}" +
      ".ffx-batch{padding:14px 16px 28px;overflow:auto;display:flex;flex-direction:column;gap:12px;min-height:0;flex:1 1 auto}" +
      ".ffx-body.is-batch{display:flex;flex-direction:column;overflow:hidden;padding:0}" +
  ".ffx-browse{display:flex;gap:6px;align-items:center}" +
  ".ffx-browse .ffx-input{flex:1 1 auto;min-width:0}" +
  ".ffx-modal{position:fixed;inset:0;background:rgba(0,0,0,.34);display:flex;align-items:center;justify-content:center;z-index:60}" +
  ".ffx-modal-panel{width:min(580px,92vw);max-height:74vh;display:flex;flex-direction:column;background:var(--dsw-alias-bg-layer-2,#fff);border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.2));border-radius:10px;box-shadow:0 12px 32px rgba(0,0,0,.24);overflow:hidden}" +
  ".ffx-modal-head{display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.16));font-size:12px;font-weight:600}" +
  ".ffx-modal-body{flex:1 1 auto;overflow:auto;padding:6px 8px;font-size:11.5px}" +
  ".ffx-modal-foot{display:flex;justify-content:flex-end;gap:8px;padding:8px 12px;border-top:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.16))}" +
  ".ffx-crumb{font-family:ui-monospace,Consolas,monospace;font-size:10.5px;color:var(--dsw-alias-label-tertiary,#8a8a8a);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
  ".ffx-entry{display:flex;align-items:center;gap:6px;padding:3px 6px;border-radius:5px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
  ".ffx-entry:hover{background:var(--dsw-alias-bg-layer-3,rgba(127,127,127,.12))}" +
  ".ffx-entry.dir{color:var(--dsw-alias-label-primary,#111);font-weight:500}" +
  ".ffx-entry.file{color:var(--dsw-alias-label-secondary,#555)}" +
  ".ffx-modal-empty{padding:10px;color:var(--dsw-alias-label-tertiary,#8a8a8a)}" +
      ".ffx-custom{margin:6px 0 8px;padding:8px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.24));border-radius:8px;background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.04))}" +
      ".ffx-custom .ffx-row{margin-bottom:6px}" +
      ".ffx-custom .ffx-row:last-child{margin-bottom:0}" +
      ".ffx-batch-grid{display:grid;grid-template-columns:minmax(0,1.05fr) minmax(0,1fr);gap:12px;align-items:start}" +
      ".ffx-batch-table{max-height:340px;overflow:auto}" +
      ".ffx-file-row{display:flex;gap:6px;align-items:center}" +
      ".ffx-file-row .ffx-input{flex:1 1 auto;min-width:0}" +
      ".ffx-pill{display:inline-flex;align-items:center;gap:4px;padding:1px 7px;border-radius:999px;font-size:10px;line-height:1.7;border:1px solid transparent}" +
      ".ffx-pill.ok{background:rgba(46,160,86,.1);color:#2a7d47;border-color:rgba(46,160,86,.3)}" +
      ".ffx-pill.warn{background:rgba(206,145,40,.12);color:#8a6416;border-color:rgba(206,145,40,.32)}" +
      ".ffx-pill.err{background:rgba(206,80,80,.1);color:#a43737;border-color:rgba(206,80,80,.3)}" +
      ".ffx-pill.run{background:rgba(70,110,210,.12);color:#3559a8;border-color:rgba(70,110,210,.32)}" +
      ".ffx-progress{height:6px;border-radius:4px;background:var(--dsw-alias-bg-layer-3,#ececee);overflow:hidden}" +
      ".ffx-progress-fill{height:100%;border-radius:4px;background:var(--dsw-alias-brand-primary,#4b7bec);transition:width .3s ease}" +
      "@media (max-width:1180px){.ffx-body{grid-template-columns:300px minmax(0,1fr)}.ffx-flowrow.mid{grid-template-columns:repeat(2,minmax(0,1fr))}.ffx-batch-grid{grid-template-columns:minmax(0,1fr)}}" +
      "@media (max-width:1180px){.ffx-batch-grid{grid-template-columns:minmax(0,1fr)}}";

    function injectStyle() {
      try {
        if (typeof document === "undefined") return;
        if (document.querySelector('style[data-plugin-css="' + STYLE_ID + '"]')) return;
        var tag = document.createElement("style");
        tag.dataset.plugin = "dsh-furniture-fireload";
        tag.dataset.pluginCss = STYLE_ID;
        tag.textContent = CSS;
        document.head.appendChild(tag);
      } catch (error) {
        /* headless */
      }
    }

    function num(value, digits) {
      if (value === null || value === undefined || value === "") return "—";
      var n = Number(value);
      if (!isFinite(n)) return "—";
      var d = typeof digits === "number" ? digits : Math.abs(n) >= 100 ? 0 : Math.abs(n) >= 10 ? 1 : 2;
      return n.toFixed(d);
    }

    function pct(value, digits) {
      if (value === null || value === undefined || value === "") return "—";
      var n = Number(value);
      if (!isFinite(n)) return "—";
      return (n * 100).toFixed(typeof digits === "number" ? digits : 1) + "%";
    }

    function pctFine(value) {
      if (value === null || value === undefined || value === "") return "—";
      var n = Number(value);
      if (!isFinite(n)) return "—";
      var v = n * 100;
      if (v >= 1) return v.toFixed(1) + "%";
      if (v >= 0.01) return v.toFixed(2) + "%";
      if (v > 0) return "<0.01%";
      return "0%";
    }

    function physicalSourceLabel(source) {
      var value = String(source || "");
      if (value === "builtin-fireprediction") return "内置训练模型";
      if (value === "fireprediction") return "Fireprediction 预测";
      if (value === "llm-estimate") return "视觉模型估计";
      if (value === "manual" || value === "manual_input") return "手工输入";
      return value || "缺失";
    }

    function normalizeFreeModel(value) {
      var text = String(value || "").trim();
      if (!text) return "";
      if (/:free$/i.test(text)) return text;
      if (/^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_./-]*$/.test(text)) return text + ":free";
      return text;
    }

    function fmtClock(ms) {
      var seconds = Math.max(0, Math.round(ms / 1000));
      if (seconds < 60) return seconds + "s";
      var minutes = Math.floor(seconds / 60);
      return minutes + "m" + (seconds % 60) + "s";
    }

    function basename(file) {
      if (!file) return "";
      var text = String(file).replace(/\\/g, "/");
      var parts = text.split("/");
      return parts[parts.length - 1] || text;
    }

    async function api(pathname, options) {
      var config = Object.assign({ cache: "no-store" }, options || {});
      if (config.body && typeof config.body !== "string") {
        config.headers = Object.assign({ "content-type": "application/json" }, config.headers || {});
        config.body = JSON.stringify(config.body);
      }
      var response = await fetch(API + pathname, config);
      var text = "";
      try {
        text = await response.text();
      } catch (error) {
        text = "";
      }
      var body = null;
      if (text) {
        try {
          body = JSON.parse(text);
        } catch (error) {
          throw new Error(pathname + " 返回了非 JSON 内容：" + text.slice(0, 160));
        }
      }
      if (!response.ok) throw new Error((body && body.error) || pathname + " 请求失败（HTTP " + response.status + "）");
      if (body && body.ok === false) throw new Error(body.error || pathname + " 请求失败");
      return body || {};
    }

    function EntryIcon(props) {
      var size = (props && props.size) || 16;
      return h(
        "svg",
        {
          viewBox: "0 0 16 16",
          width: size,
          height: size,
          fill: "none",
          stroke: "currentColor",
          strokeWidth: 1.3,
          strokeLinecap: "round",
          strokeLinejoin: "round",
          "aria-hidden": "true",
          "data-dsh-panel-entry": PANEL_ID,
        },
        h("path", { d: "M2.2 12.4h11.6" }),
        h("path", { d: "M4 12.4V6.6l2-1.6 2 1.6v5.8" }),
        h("path", { d: "M8 12.4V8.2l2-1.5 2 1.5v4.2" }),
        h("path", { d: "M5.4 4.2c.5-1.1 1.5-1.8 2.6-1.8 1.2 0 2.2.8 2.6 2" }),
        h("circle", { cx: 8, cy: 9.9, r: 0.9 }),
      );
    }

    function Section(props) {
      return h(
        "div",
        { className: "ffx-sec" },
        h("span", null, props.title),
        props.badge ? h("span", { className: "ffx-chip " + (props.tone || "") }, props.badge) : null,
        h("span", { className: "ffx-rule" }),
        props.right || null,
      );
    }

    function Field(props) {
      return h(
        "label",
        { className: "ffx-field" },
        h("span", { className: "ffx-label" }, props.label),
        props.children,
        props.hint ? h("span", { className: "ffx-hint" }, props.hint) : null,
      );
    }

    function Card(props) {
      var className = "ffx-card" + (props.tone ? " " + props.tone : "") + (props.empty ? " ghost" : "");
      return h(
        "div",
        { className: className, "data-node": props.node || null },
        h(
          "div",
          { className: "ffx-card-t" },
          props.index ? h("span", { className: "ffx-num" }, String(props.index)) : null,
          h("span", null, props.title),
          props.right ? h("span", { className: "ffx-spacer", style: { flex: "1 1 auto" } }) : null,
          props.right || null,
        ),
        props.children,
      );
    }

    function Value(props) {
      return h(
        "div",
        { className: props.hero ? "ffx-hero-val" : "ffx-val" },
        props.value,
        props.unit ? h("small", null, props.unit) : null,
      );
    }

    function Bars(props) {
      var entries = Object.entries(props.data || {}).filter(function (entry) {
        return Number(entry[1]) > 0.0005;
      });
      entries.sort(function (a, b) {
        return Number(b[1]) - Number(a[1]);
      });
      if (entries.length === 0) return h("div", { className: "ffx-note" }, props.emptyText || "暂无数据");
      var max = entries.reduce(function (top, entry) {
        return Math.max(top, Number(entry[1]));
      }, 0.0001);
      return h(
        "div",
        { className: "ffx-bars" },
        entries.map(function (entry) {
          var key = String(entry[0]);
          var value = Number(entry[1]) || 0;
          return h(
            "div",
            { className: "ffx-bar", key: key },
            h("span", { className: "ffx-bar-name", title: BROAD_LABELS[key] || key }, BROAD_LABELS[key] || key),
            h(
              "span",
              { className: "ffx-bar-track" },
              h("span", {
                className: "ffx-bar-fill",
                style: { width: Math.max(2, (value / max) * 100) + "%", background: BROAD_COLORS[key] || "var(--dsw-alias-brand-primary,#4b7bec)" },
              }),
            ),
            h("span", { className: "ffx-bar-val" }, pct(value, 1)),
          );
        }),
      );
    }

    function Table(props) {
      var rows = props.rows || [];
      var fold = react.useState(false);
      var expanded = fold[0];
      var setExpanded = fold[1];
      if (rows.length === 0) return h("div", { className: "ffx-note" }, props.emptyText || "暂无数据");
      var collapsible = props.collapsible || null;
      var limit = collapsible && Number(collapsible.limit) > 0 ? Number(collapsible.limit) : 0;
      var foldable = limit > 0 && rows.length > limit;
      var visibleRows = foldable && !expanded ? rows.slice(0, limit) : rows;
      var footer = props.footer
        ? h(
            "tfoot",
            null,
            h(
              "tr",
              null,
              props.columns.map(function (column) {
                var value = props.footer[column.key];
                return h("td", { key: column.key, className: column.align === "right" ? "ffx-num-cell" : null }, value === null || value === undefined ? "" : value);
              }),
            ),
          )
        : null;
      var table = h(
        "table",
        { className: "ffx-table" },
        h(
          "thead",
          null,
          h(
            "tr",
            null,
            props.columns.map(function (column) {
              return h("th", { key: column.key, className: column.align === "right" ? "ffx-num-cell" : null }, column.label);
            }),
          ),
        ),
        h(
          "tbody",
          null,
          visibleRows.map(function (row, rowIndex) {
            return h(
              "tr",
              { key: rowIndex },
              props.columns.map(function (column) {
                var value = typeof column.render === "function" ? column.render(row) : row[column.key];
                return h("td", { key: column.key, className: column.align === "right" ? "ffx-num-cell" : null }, value);
              }),
            );
          }),
        ),
        footer,
      );
      if (!foldable) return table;
      var hiddenCount = rows.length - visibleRows.length;
      return h(
        "div",
        null,
        table,
        h(
          "button",
          {
            type: "button",
            className: "ffx-more",
            "aria-expanded": expanded ? "true" : "false",
            onClick: function () {
              setExpanded(!expanded);
            },
          },
          expanded ? "收起（只看 " + String(limit) + " 行）" : "展开全部 " + String(rows.length) + (collapsible.unit || " 项"),
        ),
        foldable && !expanded && collapsible.hint
          ? h("div", { className: "ffx-fold-hint" }, "已折叠 " + String(hiddenCount) + " 行；" + collapsible.hint)
          : null,
      );
    }

    function LogView(props) {
      var box = react.useRef(null);
      var events = props.events || [];
      react.useEffect(
        function () {
          if (!props.autoScroll || !box.current) return;
          try {
            box.current.scrollTop = box.current.scrollHeight;
          } catch (error) {
            /* ignore */
          }
        },
        [events.length, props.autoScroll],
      );
      if (events.length === 0) return h("div", { className: "ffx-note" }, "还没有日志。");
      return h(
        "div",
        { className: "ffx-log", ref: box },
        events.map(function (event, index) {
          var level = event.level === "error" ? " is-error" : event.level === "warn" ? " is-warn" : "";
          return h(
            "div",
            { className: "ffx-log-line" + level, key: index },
            h("span", { className: "ffx-log-time" }, new Date(event.at || Date.now()).toLocaleTimeString("zh-CN", { hour12: false })),
            h("span", { className: "ffx-log-stage" }, String(event.stage || "")),
            h("span", null, String(event.message || "")),
          );
        }),
      );
    }

    function statusChip(job) {
      if (!job) return h("span", { className: "ffx-chip" }, "未运行");
      var state = job.state;
      var tone = state === "succeeded" ? "ok" : state === "failed" ? "err" : state === "cancelled" ? "warn" : "run";
      return h("span", { className: "ffx-chip " + tone }, STATUS_LABELS[state] || state);
    }

    // bridge 里的 auto_status.stages 是 {status, ...} 对象，直接当子节点会崩。
    function stageText(value) {
      if (value === null || value === undefined || value === "") return "—";
      if (typeof value === "string") return value;
      if (typeof value === "object") {
        return String(value.status || value.state || value.error || "—");
      }
      return String(value);
    }

    // 本地路径选择器：避免让用户手敲 D:\... 这种路径（0.6.1 起）。
    function PathPicker(props) {
      var kind = props.kind === "xlsx" ? "xlsx" : "images";
      var stateHook = react.useState({ path: "", parent: "", roots: [], dirs: [], files: [], loading: true, error: "" });
      var ui = stateHook[0];
      var setUi = function (patch) {
        stateHook[1](function (previous) {
          return Object.assign({}, previous, patch);
        });
      };

      function load(target) {
        setUi({ loading: true, error: "" });
        api("/browse?kind=" + encodeURIComponent(kind) + "&path=" + encodeURIComponent(target || ""))
          .then(function (body) {
            setUi({
              loading: false,
              path: body.path || "",
              parent: body.parent || "",
              roots: body.roots || [],
              dirs: body.dirs || [],
              files: body.files || [],
            });
          })
          .catch(function (error) {
            setUi({ loading: false, error: String((error && error.message) || error) });
          });
      }

      react.useEffect(function () {
        load(props.startPath || "");
      }, []);

      function choose(value) {
        if (props.onPick) props.onPick(value);
        if (props.onClose) props.onClose();
      }

      var entries = [];
      ui.dirs.forEach(function (dir) {
        entries.push(
          h(
            "div",
            { key: "d:" + dir.path, className: "ffx-entry dir", title: dir.path, onClick: function () { load(dir.path); } },
            "📁 " + dir.name,
          ),
        );
      });
      ui.files.forEach(function (file) {
        entries.push(
          h(
            "div",
            { key: "f:" + file.path, className: "ffx-entry file", title: file.path, onClick: function () { choose(file.path); } },
            "📄 " + file.name,
          ),
        );
      });

      return h(
        "div",
        { className: "ffx-modal", onClick: function (event) { if (event.target === event.currentTarget && props.onClose) props.onClose(); } },
        h(
          "div",
          { className: "ffx-modal-panel" },
          h(
            "div",
            { className: "ffx-modal-head" },
            h("span", null, kind === "xlsx" ? "选择批量输入 Excel" : "选择图片文件夹"),
            h("span", { className: "ffx-spacer", style: { flex: "1 1 auto" } }),
            h("button", { type: "button", className: "ffx-btn", onClick: props.onClose }, "关闭"),
          ),
          h(
            "div",
            { className: "ffx-modal-head", style: { gap: 6 } },
            h("button", { type: "button", className: "ffx-btn", disabled: !ui.parent, onClick: function () { load(ui.parent); } }, "上一级"),
            h("span", { className: "ffx-crumb", title: ui.path || "（根目录）" }, ui.path || "（根目录）"),
          ),
          h(
            "div",
            { className: "ffx-modal-body" },
            ui.loading ? h("div", { className: "ffx-modal-empty" }, "读取中…") : null,
            ui.error ? h("div", { className: "ffx-error" }, ui.error) : null,
            !ui.path && ui.roots.length
              ? ui.roots.map(function (root) {
                  return h("div", { key: "r:" + root.path, className: "ffx-entry dir", title: root.path, onClick: function () { load(root.path); } }, "💽 " + root.name);
                })
              : null,
            !ui.loading && !ui.error && !entries.length && !ui.roots.length
              ? h("div", { className: "ffx-modal-empty" }, kind === "xlsx" ? "此文件夹下没有 .xlsx 文件" : "此文件夹下没有图片（jpg/png/webp/bmp/gif）")
              : null,
            entries,
            kind === "images" && ui.path
              ? h("div", { className: "ffx-note", style: { marginTop: 6 } }, "当前文件夹有 " + String(ui.files.length) + " 张图片；点「选择此文件夹」使用它。")
              : null,
          ),
          h(
            "div",
            { className: "ffx-modal-foot" },
            h("button", { type: "button", className: "ffx-btn", onClick: props.onClose }, "取消"),
            kind === "images" && ui.path
              ? h("button", { type: "button", className: "ffx-btn primary", onClick: function () { choose(ui.path); } }, "选择此文件夹")
              : null,
          ),
        ),
      );
    }

    function BatchView(props) {
      var form = props.form || {};
      var stateHook = react.useState({
        ready: false,
        batch: null,
        error: "",
        xlsxPath: "",
        imagesDir: "",
        limit: "",
        unit: "cm",
        uploadName: "",
        uploading: false,
        starting: false,
        picker: null,
        segEngine: form.segmentEngine || "yolo",
        models: [],
        modelsError: "",
        estimateSource: form.llmEstimateEnabled ? "llm" : "fireprediction",
        estimateRoute: form.llmEstimateProviderId && form.llmEstimateModel ? form.llmEstimateProviderId + "|" + form.llmEstimateModel : "",
        materialRoute: form.deciderProviderId && form.deciderModel ? form.deciderProviderId + "|" + form.deciderModel : "",
      });
      var ui = stateHook[0];
      var setUi = function (patch) {
        stateHook[1](function (previous) {
          return Object.assign({}, previous, typeof patch === "function" ? patch(previous) : patch);
        });
      };

      function splitRoute(value) {
        var text = String(value || "");
        var index = text.indexOf("|");
        if (index < 0) return { providerId: "", model: "" };
        return { providerId: text.slice(0, index), model: text.slice(index + 1) };
      }

      react.useEffect(function () {
        var alive = true;
        api("/models")
          .then(function (body) {
            if (!alive) return;
            setUi({ models: (body && body.providers) || [], modelsError: body && body.llm ? "" : "当前会话没有可用的模型服务" });
          })
          .catch(function (error) {
            if (alive) setUi({ modelsError: String(error.message || error) });
          });
        return function () {
          alive = false;
        };
      }, []);

      function pipelinePatch() {
        function routeFor(parsed) {
          return { channel: "host", providerId: parsed.providerId, model: parsed.model, baseUrl: "", apiKey: "" };
        }

        function libraryModel(id) {
          var list = (Array.isArray(form.customModels) ? form.customModels : []).filter(function (item) {
            return item && String(item.model || "").trim();
          });
          for (var i = 0; i < list.length; i += 1) {
            if (String(list[i].id || "") === String(id || "")) return list[i];
          }
          return null;
        }

        function resolveSlot(routeValue) {
          var text = String(routeValue || "");
          if (text.indexOf("custom:") === 0) {
            var item = libraryModel(text.slice(7));
            if (item) {
              return {
                channel: "api",
                providerId: "",
                model: String(item.model || ""),
                baseUrl: String(item.baseUrl || ""),
                apiKey: String(item.apiKey || ""),
                vision: Boolean(item.vision),
                label: String(item.label || item.model || ""),
              };
            }
          }
          return routeFor(splitRoute(text));
        }

        var materialSlot = resolveSlot(ui.materialRoute);
        var estimateSlot = ui.estimateSource === "llm" ? resolveSlot(ui.estimateRoute) : { channel: "host", providerId: "", model: "" };
        var segValue = String(ui.segEngine || "yolo");
        var segEngine = segValue.indexOf("custom:") === 0 ? "custom" : segValue === "llm" ? "llm" : "yolo";
        return {
          device: form.device,
          useFireprediction: Boolean(form.useFireprediction),
          volumeKind: form.volumeKind,
          llmEstimate: { enabled: ui.estimateSource === "llm" },
          models: {
            segmentation: materialSlot,
            estimate: estimateSlot,
          },
          segmentation: {
            engine: segEngine,
            customModelId: segValue.indexOf("custom:") === 0 ? segValue.slice(7) : "",
            conf: Number(form.conf) || 0.25,
            metalConf: Number(form.metalConf) || 0.2,
            metalEnabled: Boolean(form.metalEnabled),
          },
          decider: {
            provider: form.deciderProvider,
            channel: form.deciderChannel,
            providerId: materialSlot.providerId || form.deciderProviderId,
            model: materialSlot.model || (form.deciderProvider === "free-vision" ? normalizeFreeModel(form.deciderModel) : form.deciderModel),
            vision: form.deciderVision || "auto",
            apiKey: form.deciderApiKey,
            baseUrl: form.deciderBaseUrl,
            jevModel: form.jevModel,
          },
          review: {
            provider: form.reviewProvider,
            model: form.reviewProvider === "jev" ? form.reviewModel : normalizeFreeModel(form.reviewModel),
            apiKey: form.reviewApiKey,
          },
        };
      }

      react.useEffect(function () {
        var alive = true;
        function tick() {
          api("/batch")
            .then(function (body) {
              if (!alive) return;
              var batch = body && body.batch ? body.batch : null;
              setUi(function (previous) {
                var next = { ready: true, batch: batch };
                if (batch && !previous.xlsxPath) next.xlsxPath = batch.xlsxPath || "";
                if (batch && !previous.imagesDir) next.imagesDir = batch.imagesDir || "";
                return next;
              });
            })
            .catch(function (error) {
              if (alive) setUi({ ready: true, error: String(error.message || error) });
            });
        }
        tick();
        var timer = window.setInterval(tick, 1800);
        return function () {
          alive = false;
          window.clearInterval(timer);
        };
      }, []);

      function pickXlsx(event) {
        var file = event.target.files && event.target.files[0];
        if (!file) return;
        if (!/\.xlsx$/i.test(file.name)) {
          setUi({ error: "批量输入只支持 .xlsx 文件。" });
          return;
        }
        var reader = new FileReader();
        reader.onload = function () {
          setUi({ uploading: true, error: "" });
          api("/batch/upload", { method: "POST", body: { name: file.name, dataBase64: String(reader.result || "") } })
            .then(function (body) {
              setUi({ uploading: false, xlsxPath: body.path, uploadName: body.name });
            })
            .catch(function (error) {
              setUi({ uploading: false, error: String(error.message || error) });
            });
        };
        reader.readAsDataURL(file);
        event.target.value = "";
      }

      function start() {
        if (ui.starting) return;
        if (!ui.xlsxPath.trim()) {
          setUi({ error: "请先选择批量输入 Excel：点「浏览…」挑一个 .xlsx 文件，或点「上传」。" });
          return;
        }
        if (!ui.imagesDir.trim()) {
          setUi({ error: "请选择图片文件夹：点「图片文件夹」旁的「浏览…」，进入放了图片的文件夹后点「选择此文件夹」。" });
          return;
        }
        var body = pipelinePatch();
        body.xlsxPath = ui.xlsxPath.trim();
        body.imagesDir = ui.imagesDir.trim();
        body.defaultUnit = ui.unit;
        body.limit = Number(ui.limit) || 0;
        setUi({ starting: true, error: "" });
        api("/batch", { method: "POST", body: { batch: body } })
          .then(function (res) {
            setUi({ starting: false, batch: res.batch });
          })
          .catch(function (error) {
            setUi({ starting: false, error: String(error.message || error) });
          });
      }

      function cancel() {
        var batch = ui.batch;
        if (!batch) return;
        api("/batch/cancel", { method: "POST", body: { id: batch.id } })
          .then(function () {
            setUi(function (previous) {
              return { batch: previous.batch ? Object.assign({}, previous.batch, { state: "cancelled" }) : null };
            });
          })
          .catch(function (error) {
            setUi({ error: String(error.message || error) });
          });
      }

      var batch = ui.batch;
      var items = (batch && batch.items) || [];
      var finished = items.filter(function (item) {
        return item.status === "ok" || item.status === "failed" || item.status === "skipped";
      }).length;
      var total = (batch && batch.total) || 0;
      var running = Boolean(batch && (batch.state === "queued" || batch.state === "running"));
      var percent = total > 0 ? Math.max(2, Math.min(100, Math.round((finished / total) * 100))) : 0;
      var stateText = !batch
        ? "未开始"
        : batch.state === "running"
          ? "运行中"
          : batch.state === "queued"
            ? "排队中"
            : batch.state === "succeeded"
              ? "已完成"
              : batch.state === "cancelled"
                ? "已取消"
                : batch.state === "failed"
                  ? "失败"
                  : batch.state;
      var stateLevel = batch ? (batch.state === "succeeded" ? "ok" : batch.state === "failed" ? "err" : batch.state === "cancelled" ? "warn" : "run") : "warn";
      var columns = [
        { key: "id", label: "编号" },
        { key: "category", label: "家具类型" },
        { key: "dimensionsText", label: "尺寸" },
        {
          key: "status",
          label: "状态",
          render: function (row) {
            var map = { ok: ["完成", "ok"], failed: ["失败", "err"], skipped: ["跳过", "warn"], pending: ["待处理", "warn"] };
            var entry = map[row.status] || [row.status || "—", "warn"];
            return h("span", { className: "ffx-pill " + entry[1] }, entry[0]);
          },
        },
        {
          key: "regionEngine",
          label: "区域识别",
          render: function (row) {
            var label = row.summary && row.summary.regionEngine ? String(row.summary.regionEngine) : "—";
            var fallback = row.summary && row.summary.segmentationFallbackError;
            return h("span", { className: "ffx-pill " + (label === "视觉大模型" ? "ok" : ""), title: fallback ? String(fallback) : "" }, label);
          },
        },
        {
          key: "physicalLabel",
          label: "质量体积来源",
          render: function (row) {
            var label = row.summary && row.summary.physicalLabel ? String(row.summary.physicalLabel) : "—";
            var fallback = row.summary && row.summary.llmEstimateError;
            return h("span", { className: "ffx-pill " + (label === "视觉大模型估计" ? "ok" : ""), title: fallback ? String(fallback) : "" }, label);
          },
        },
        {
          key: "massKg",
          label: "质量 kg",
          align: "right",
          render: function (row) {
            return row.summary && row.summary.massKg != null ? num(row.summary.massKg, 2) : "—";
          },
        },
        {
          key: "fireLoadMj",
          label: "火灾荷载 MJ",
          align: "right",
          render: function (row) {
            return row.summary && row.summary.fireLoadMj != null ? num(row.summary.fireLoadMj, 1) : "—";
          },
        },
        { key: "imageName", label: "图片" },
        {
          key: "problem",
          label: "备注",
          render: function (row) {
            return row.problem ? String(row.problem).slice(0, 80) : row.elapsedMs ? fmtClock(row.elapsedMs) : "";
          },
        },
      ];
      var okCount = items.filter(function (item) {
        return item.status === "ok";
      }).length;
      var failedCount = items.filter(function (item) {
        return item.status === "failed";
      }).length;
      var skippedCount = items.filter(function (item) {
        return item.status === "skipped";
      }).length;
      var resultUrl = batch && batch.outputName ? API + "/batch/file?id=" + encodeURIComponent(batch.id) + "&name=" + encodeURIComponent(batch.outputName) : "";
      var events = (batch && batch.events) || [];

      function routeOptions() {
        var options = [h("option", { value: "", key: "auto" }, "（自动：宿主默认模型）")];
        for (var g = 0; g < (ui.models || []).length; g += 1) {
          var group = ui.models[g];
          var list = group.models || [];
          for (var m = 0; m < list.length; m += 1) {
            var model = list[m];
            var value = String(group.id) + "|" + String(model.id);
            options.push(
              h(
                "option",
                { value: value, key: value },
                String(group.label || group.id) + " / " + String(model.label || model.id) + (model.vision ? " · 支持图片" : "")
              )
            );
          }
        }
        var custom = (Array.isArray(form.customModels) ? form.customModels : []).filter(function (item) {
          return item && String(item.model || "").trim();
        });
        if (custom.length) {
          options.push(
            h(
              "optgroup",
              { label: "自定义模型（0 自定义模型）", key: "custom-group" },
              custom.map(function (item) {
                return h(
                  "option",
                  { value: "custom:" + String(item.id || item.model), key: "custom-" + String(item.id || item.model) },
                  String(item.label || item.model) + "（" + String(item.model) + "）" + (item.vision ? " · 支持图片" : "")
                );
              })
            )
          );
        }
        return options;
      }

      return h(
        "div",
        { className: "ffx-batch" },
        h(
          "div",
          { className: "ffx-batch-grid" },
          h(
            Card,
            { title: "1 批量输入" },
            ui.error ? h("div", { className: "ffx-error", style: { marginTop: 0, marginBottom: 8 } }, ui.error) : null,
            h(
              Field,
              { label: "Excel 文件", hint: "表格前三列建议为 编号 / 家具类型 / 尺寸；尺寸写成 120×75×60 cm 这类形式。也可以只上传文件由工具自动识别列。" },
              h(
                "div",
                { className: "ffx-file-row" },
                h("input", { className: "ffx-input", value: ui.xlsxPath, placeholder: "D:\\项目\\家具清单.xlsx", onChange: function (event) { setUi({ xlsxPath: event.target.value }); } }),
                h("button", { type: "button", className: "ffx-btn", onClick: function () { setUi({ picker: "xlsx" }); } }, "浏览…"),
                h(
                  "button",
                  { type: "button", className: "ffx-btn", onClick: function (event) { var input = event.currentTarget.parentNode.querySelector('input[type="file"]'); if (input) input.click(); }, disabled: ui.uploading },
                  ui.uploading ? "上传中…" : "上传",
                ),
                h("input", { type: "file", accept: ".xlsx", style: { display: "none" }, onChange: pickXlsx }),
              ),
            ),
            h(
              "div",
              { className: "ffx-note" },
              "还没有表格？",
              h("a", { className: "ffx-link", href: API + "/batch/template", download: "批量输入模板.xlsx" }, " 下载模板"),
              ui.uploadName ? "（已上传 " + ui.uploadName + "）" : "",
            ),
            h(Field, { label: "图片文件夹", hint: "点「浏览…」选文件夹；图片以编号命名（001.jpg、002.png…），也支持 001_沙发.jpg 这种前缀写法。" }, h(
              "div",
              { className: "ffx-browse" },
              h("input", { className: "ffx-input", value: ui.imagesDir, placeholder: "D:\\项目\\家具图片", onChange: function (event) { setUi({ imagesDir: event.target.value }); } }),
              h("button", { type: "button", className: "ffx-btn", onClick: function () { setUi({ picker: "images" }); } }, "浏览…"),
            )),
            h(
              "div",
              { className: "ffx-row" },
              h(
                Field,
                { label: "尺寸默认单位" },
                h("select", { className: "ffx-select", value: ui.unit, onChange: function (event) { setUi({ unit: event.target.value }); } }, h("option", { value: "cm" }, "cm"), h("option", { value: "mm" }, "mm"), h("option", { value: "m" }, "m")),
              ),
              h(Field, { label: "只跑前 N 条", hint: "留空表示全部" }, h("input", { className: "ffx-input", value: ui.limit, placeholder: "全部", onChange: function (event) { setUi({ limit: event.target.value }); } })),
            ),
            h(
              "div",
              { className: "ffx-row" },
              h(
                Field,
                {
                  label: "材质区域识别",
                  hint:
                    String(ui.segEngine || "").indexOf("custom:") === 0
                      ? "每件都会请求一次自定义视觉模型（目标框 + 可见材质面积占比），失败的件自动回退本机 YOLO。"
                      : ui.segEngine === "llm"
                        ? "每件都会请求一次视觉模型（目标框 + 可见材质面积占比），失败的件自动回退本机 YOLO。"
                        : "和单件页一样用本机 YOLO；图片多时最快。",
                },
                h(
                  "select",
                  { className: "ffx-select", value: ui.segEngine, onChange: function (event) { setUi({ segEngine: event.target.value }); } },
                  h("option", { value: "yolo" }, "本机 YOLO 分割"),
                  h("option", { value: "llm" }, "宿主模型直接判定（每件一次请求）"),
                  (Array.isArray(form.customModels) ? form.customModels : []).filter(function (item) {
                    return item && String(item.model || "").trim();
                  }).length === 0
                    ? null
                    : h(
                        "optgroup",
                        { label: "自定义模型（0 自定义模型）" },
                        (Array.isArray(form.customModels) ? form.customModels : [])
                          .filter(function (item) { return item && String(item.model || "").trim(); })
                          .map(function (item) {
                            return h("option", { key: "bseg-" + String(item.id || item.model), value: "custom:" + String(item.id || item.model) }, (item.label || item.model) + "（" + item.model + "）" + (item.vision ? " · 支持图片" : ""));
                          }),
                      ),
                ),
              ),
              h(
                Field,
                { label: "质量体积来源", hint: ui.estimateSource === "llm" ? "每件都会请视觉模型估计质量与包裹体积；失败的件自动回退内置训练模型。" : "用插件内置的训练模型预测（Fireprediction，CPU 约 3~5 秒/件）。" },
                h(
                  "select",
                  { className: "ffx-select", value: ui.estimateSource, onChange: function (event) { setUi({ estimateSource: event.target.value }); } },
                  h("option", { value: "fireprediction" }, "训练模型预测（Fireprediction，内置）"),
                  h("option", { value: "llm" }, "视觉大模型直接估计（每件一次请求）"),
                ),
              ),
            ),
            h(
              "div",
              { className: "ffx-row" },
              h(
                Field,
                { label: "材质判定模型", hint: ui.modelsError || "和单件页一样直接在下拉里挑：宿主模型、或「0 自定义模型」里保存的模型（含地址与密钥）。用于区域识别（选「视觉大模型」时）与材质组合判定。" },
                h("select", { className: "ffx-select", value: ui.materialRoute, onChange: function (event) { setUi({ materialRoute: event.target.value }); } }, routeOptions()),
              ),
              ui.estimateSource === "llm"
                ? h(
                    Field,
                    { label: "质量体积估计模型", hint: "只用于估计质量/体积；可以和判定模型不同。" },
                    h("select", { className: "ffx-select", value: ui.estimateRoute, onChange: function (event) { setUi({ estimateRoute: event.target.value }); } }, routeOptions()),
                  )
                : null,
            ),
            h(
              "div",
              { className: "ffx-note" },
              "批量分析沿用「单件分析」里的视觉复核与分割阈值；质量体积来源、材质判定模型与质量体积估计模型都可以在这里单独选（和单件页一样，下拉里直接列宿主模型与「0 自定义模型」里的模型）。选「视觉大模型直接估计」时，质量/体积与材质判定可以由不同的大模型分别负责，失败的件只回退该件。",
            ),
            h(
              "div",
              { className: "ffx-actions" },
              h("button", { type: "button", className: "ffx-btn primary", onClick: start, disabled: running || ui.starting }, ui.starting ? "提交中…" : running ? "批量运行中…" : "开始批量"),
              running ? h("button", { type: "button", className: "ffx-btn", onClick: cancel }, "取消") : null,
              h("span", { className: "ffx-pill " + stateLevel }, stateText + (total ? " · " + finished + "/" + total : "")),
            ),
          ),
          h(
            Card,
            { title: "2 进度" },
            h(
              "div",
              null,
              h("div", { className: "ffx-progress" }, h("div", { className: "ffx-progress-fill", style: { width: percent + "%" } })),
              h(
                "div",
                { className: "ffx-note", style: { marginTop: 6 } },
                "成功 " + String(okCount) + " · 失败 " + String(failedCount) + " · 跳过 " + String(skippedCount) + (batch && batch.currentId && running ? " · 当前：" + batch.currentId : ""),
              ),
              batch && batch.error ? h("div", { className: "ffx-error" }, batch.error) : null,
              resultUrl
                ? h("div", { style: { marginTop: 8 } }, h("a", { className: "ffx-link", href: resultUrl, download: batch.outputName }, "下载结果 Excel（" + batch.outputName + "）"))
                : h("div", { className: "ffx-note", style: { marginTop: 8 } }, "完成后可在这里下载结果 Excel。"),
              batch && batch.outputDir ? h("div", { className: "ffx-note" }, "输出目录：" + batch.outputDir) : null,
            ),
            h("div", { style: { marginTop: 10 } }, h(LogView, { events: events.slice(-40), autoScroll: true })),
          ),
        ),
        h(
          Card,
          { title: "3 逐件结果" },
          h(Table, {
            rows: items,
            columns: columns,
            emptyText: running ? "第一件还在跑，稍等一会儿…" : "还没有批量结果：选择 Excel 与图片文件夹后点「开始批量」。",
            collapsible: { limit: 12, unit: " 行", hint: "完整结果请下载 Excel。" },
          }),
          h("div", { className: "ffx-note", style: { marginTop: 8 } }, "Excel 里的尺寸直接换算成包围盒参与 Fireprediction；编号与图片按文件名匹配（不区分大小写，允许 001 / 001.jpg / 001_沙发.jpg）。"),
        ),
        ui.picker
          ? h(PathPicker, {
              kind: ui.picker,
              startPath: ui.picker === "xlsx" ? ui.xlsxPath || ui.imagesDir : ui.imagesDir || ui.xlsxPath,
              onPick: function (value) {
                if (ui.picker === "xlsx") setUi({ xlsxPath: value, error: "" });
                else setUi({ imagesDir: value, error: "" });
              },
              onClose: function () { setUi({ picker: null }); },
            })
          : null,
      );
    }

    function Workbench(props) {
      var stateHook = react.useState({
        ready: false,
        error: null,
        state: null,
        models: [],
        modelsError: null,
        busy: false,
        job: null,
        payload: null,
        events: [],
        artifacts: [],
        error2: null,
        selfCheck: null,
        previewUrl: null,
        uploading: false,
        advanced: false,
        llmEstimate: null,
        llmSegmentation: null,
        view: "single",
      });
      var ui = stateHook[0];
      var setUi = function (patch) {
        setUiRaw(function (previous) {
          return Object.assign({}, previous, typeof patch === "function" ? patch(previous) : patch);
        });
      };
      var setUiRaw = stateHook[1];
      var view = ui.view || "single";
      var setView = function (next) {
        setUi({ view: next });
      };

      var formHook = react.useState(null);
      var form = formHook[0];
      var setFormRaw = formHook[1];
      var setForm = function (patch) {
        setFormRaw(function (previous) {
          var base = previous || {};
          return Object.assign({}, base, typeof patch === "function" ? patch(base) : patch);
        });
      };

      var uiRef = react.useRef(ui);
      uiRef.current = ui;
      var formRef = react.useRef(form);
      formRef.current = form;

      function applySettings(settings) {
        if (!settings) return;
        var storedProvider = (settings.decider && settings.decider.provider) || "deepseek";
        var storedModel = (settings.decider && settings.decider.model) || "";
        // A model id left over from another branch (e.g. "deepseek-flash" while the
        // decider is set to a free-only endpoint) would be rejected by the API, so
        // drop it and let the placeholder show the default free model.
        if (storedProvider === "free-vision" && storedModel && !/:free$/i.test(storedModel)) storedModel = "";
        var next = {
          imagePath: "",
          imageName: "",
          category: "床",
          width: "200",
          height: "60",
          depth: "180",
          unit: "cm",
          unitPreset: "",
          massKg: "",
          volumeM3: "",
          volumeKind: "envelope",
          useFireprediction: true,
          device: settings.device || "auto",
          deciderProvider: storedProvider,
          deciderChannel: (settings.decider && settings.decider.channel) || "host",
          deciderProviderId: (settings.decider && settings.decider.providerId) || "",
          deciderModel: storedModel,
          deciderVision: (settings.decider && settings.decider.vision) || "auto",
          deciderBaseUrl: (settings.decider && settings.decider.baseUrl) || "https://api.deepseek.com",
          deciderApiKey: (settings.decider && settings.decider.apiKey) || "",
          jevModel: (settings.decider && settings.decider.jevModel) || "perplexity/pplx-decider-v1.2",
          reviewProvider: (settings.review && settings.review.provider) || "auto",
          reviewModel: (settings.review && settings.review.model) || "nvidia/nemotron-3.5-super-vl:free",
          reviewApiKey: (settings.review && settings.review.apiKey) || "",
          reviewCustomId: (settings.review && settings.review.customModelId) || "",
          conf: String((settings.segmentation && settings.segmentation.conf) || 0.25),
          metalConf: String((settings.segmentation && settings.segmentation.metalConf) || 0.2),
          segmentEngine: ["llm", "custom"].includes((settings.segmentation && settings.segmentation.engine)) ? settings.segmentation.engine : "yolo",
          segmentCustomId: (settings.segmentation && settings.segmentation.customModelId) || "",
          metalEnabled: settings.segmentation ? Boolean(settings.segmentation.metalEnabled) : true,
          llmEstimateEnabled: settings.llmEstimate ? Boolean(settings.llmEstimate.enabled) : false,
          llmEstimateRole: (settings.llmEstimate && settings.llmEstimate.role) || "extra",
          llmEstimateModel: (settings.llmEstimate && settings.llmEstimate.model) || "",
          deciderCustomId: (settings.decider && settings.decider.customModelId) || "",
          estimateCustomId: (settings.llmEstimate && settings.llmEstimate.customModelId) || "",
          customModels: Array.isArray(settings.customModels) ? settings.customModels : [],
          customOpen: false,
        };
        try {
          var stored = window.localStorage.getItem("dsh-furniture-fireload.form");
          if (stored) {
            var parsed = JSON.parse(stored);
            Object.keys(next).forEach(function (key) {
              if (parsed && parsed[key] !== undefined && parsed[key] !== null && !key.endsWith("ApiKey")) next[key] = parsed[key];
            });
          }
        } catch (error) {
          /* ignore */
        }
        setForm(next);
      }

      react.useEffect(
        function () {
          var alive = true;
          api("/state")
            .then(function (body) {
              if (!alive) return;
              setUi({ ready: true, state: body, error: null });
              applySettings(body.settings);
            })
            .catch(function (error) {
              if (!alive) return;
              setUi({ ready: true, error: String(error.message || error) });
            });
          return function () {
            alive = false;
          };
        },
        [],
      );

      react.useEffect(
        function () {
          if (!form) return;
          try {
            var copy = Object.assign({}, form);
            delete copy.deciderApiKey;
            delete copy.reviewApiKey;
            window.localStorage.setItem("dsh-furniture-fireload.form", JSON.stringify(copy));
          } catch (error) {
            /* ignore */
          }
        },
        [form],
      );

      // Host model list feeds the "判定模型 / 视觉复核" dropdowns, so fetch it once
      // regardless of which branch is selected today.
      react.useEffect(
        function () {
          if (ui.models.length > 0 || ui.modelsError) return;
          var alive = true;
          api("/models")
            .then(function (body) {
              if (!alive) return;
              var providers = body.providers || [];
              setUi({ models: providers, modelsError: body.llm ? null : "当前会话没有可用的模型服务，请改用自定义模型。" });
            })
            .catch(function (error) {
              if (!alive) return;
              setUi({ modelsError: String(error.message || error) });
            });
          return function () {
            alive = false;
          };
        },
        [ui.models.length, ui.modelsError],
      );

      var running = ui.job && (ui.job.state === "running" || ui.job.state === "queued");
      react.useEffect(
        function () {
          if (!ui.job || !ui.job.id) return;
          if (!running) return;
          var alive = true;
          var timer = window.setInterval(function () {
            api("/job?id=" + encodeURIComponent(ui.job.id))
              .then(function (body) {
                if (!alive) return;
                setUi({
                  job: body.job,
                  events: body.events || [],
                  payload: body.payload || null,
                  llmEstimate: body.llmEstimate || null,
                  llmSegmentation: body.llmSegmentation || null,
                  artifacts: body.artifacts || [],
                  selfCheck: body.job && body.job.state === "failed" ? body.stderr : ui.selfCheck,
                });
              })
              .catch(function (error) {
                if (!alive) return;
                setUi({ error2: String(error.message || error) });
              });
          }, 900);
          return function () {
            alive = false;
            window.clearInterval(timer);
          };
        },
        [ui.job && ui.job.id, running],
      );

      function pickFile(event) {
        var file = event.target.files && event.target.files[0];
        if (!file) return;
        var reader = new FileReader();
        setUi({ uploading: true, error2: null });
        reader.onload = function () {
          var dataUrl = String(reader.result || "");
          api("/upload", { method: "POST", body: { name: file.name, dataBase64: dataUrl } })
            .then(function (body) {
              setForm({ imagePath: body.path, imageName: body.name });
              var url = "";
              try {
                url = URL.createObjectURL(file);
              } catch (error) {
                url = "";
              }
              setUi({ uploading: false, previewUrl: url });
            })
            .catch(function (error) {
              setUi({ uploading: false, error2: String(error.message || error) });
            });
        };
        reader.onerror = function () {
          setUi({ uploading: false, error2: "读取本地图片失败。" });
        };
        reader.readAsDataURL(file);
      }

      function changeDeciderProvider(next) {
        // Stale model ids from another branch must never leak into a free-only
        // endpoint: that is what aborted the run with a :free validation error.
        var patch = { deciderProvider: next };
        if (next === "free-vision" || next === "none") patch.deciderModel = "";
        if (next !== "custom") patch.deciderCustomId = "";
        setForm(patch);
      }

      function customRows() {
        // Editor list: keep rows even when the model name is still empty, otherwise
        // a freshly added row would never render and the button looks dead.
        return form && Array.isArray(form.customModels) ? form.customModels : [];
      }

      function hostModelGroups() {
        return (Array.isArray(ui.models) ? ui.models : [])
          .map(function (group) {
            return { id: group.id, label: group.label || group.id, models: Array.isArray(group.models) ? group.models : [] };
          })
          .filter(function (group) {
            return group.models.length > 0;
          });
      }

      // One dropdown per step (3/4/5/6): the value string carries the whole route.
      function deciderSelectValue() {
        if (!form) return "host:auto";
        if (form.deciderProvider === "custom") return form.deciderCustomId ? "custom:" + form.deciderCustomId : "custom:none";
        if (form.deciderProvider === "deepseek") {
          var pid = String(form.deciderProviderId || "");
          var mid = String(form.deciderModel || "");
          if (!pid || !mid) return "host:auto";
          var groups = hostModelGroups();
          if (groups.length === 0) return "host:auto";
          var group = groups.find(function (item) { return item.id === pid; });
          if (!group || !group.models.some(function (item) { return item.id === mid; })) return "host:auto";
          return "host:" + pid + "|" + mid;
        }
        return form.deciderProvider;
      }

      function changeDeciderSelect(value) {
        var text = String(value || "");
        if (text.indexOf("custom:") === 0) {
          var id = text.slice(7);
          setForm({ deciderProvider: "custom", deciderCustomId: id === "none" ? "" : id, deciderChannel: "host" });
          return;
        }
        if (text.indexOf("host:") === 0) {
          var rest = text.slice(5);
          if (!rest || rest === "auto") {
            setForm({ deciderProvider: "deepseek", deciderChannel: "host", deciderProviderId: "", deciderModel: "" });
            return;
          }
          var parts = rest.split("|");
          setForm({ deciderProvider: "deepseek", deciderChannel: "host", deciderProviderId: parts[0] || "", deciderModel: parts[1] || "" });
          return;
        }
        setForm({ deciderProvider: text, deciderChannel: "host", deciderCustomId: "", deciderModel: "" });
      }

      function reviewSelectValue() {
        if (!form) return "auto";
        if (form.reviewProvider === "custom") return form.reviewCustomId ? "custom:" + form.reviewCustomId : "custom:none";
        if (form.reviewProvider === "none") return "off";
        if (form.reviewProvider === "jev") return "jev";
        return "auto";
      }

      function changeReviewSelect(value) {
        var text = String(value || "");
        if (text.indexOf("custom:") === 0) {
          var id = text.slice(7);
          setForm({ reviewProvider: "custom", reviewCustomId: id === "none" ? "" : id });
          return;
        }
        if (text === "off") setForm({ reviewProvider: "none", reviewCustomId: "" });
        else if (text === "jev") setForm({ reviewProvider: "jev", reviewCustomId: "" });
        else setForm({ reviewProvider: "auto", reviewCustomId: "" });
      }

      function customLibrary() {
        return customRows().filter(function (item) {
          return item && String(item.model || "").trim();
        });
      }

      function findCustom(id) {
        var wanted = String(id || "");
        var hits = customLibrary().filter(function (item) {
          return String(item.id) === wanted;
        });
        return hits.length ? hits[0] : null;
      }

      function patchCustomAt(index, patch) {
        setForm(function (previous) {
          var list = Array.isArray(previous.customModels) ? previous.customModels.slice() : [];
          list[index] = Object.assign({}, list[index], patch);
          return { customModels: list };
        });
      }

      function addCustomModel() {
        setForm(function (previous) {
          var list = Array.isArray(previous.customModels) ? previous.customModels.slice() : [];
          list.push({
            id: "local-" + Date.now().toString(36) + "-" + String(list.length + 1),
            label: "模型 " + String(list.length + 1),
            baseUrl: "https://api.deepseek.com",
            model: "",
            apiKey: "",
            vision: false,
          });
          return { customModels: list, customOpen: true };
        });
      }

      function removeCustomAt(index) {
        setForm(function (previous) {
          var list = Array.isArray(previous.customModels) ? previous.customModels.slice() : [];
          list.splice(index, 1);
          return { customModels: list };
        });
      }

      function persistSettings() {
        if (!form) return Promise.resolve();
        var payload = {
          settings: {
            device: form.device,
            useFireprediction: Boolean(form.useFireprediction),
            decider: {
              provider: form.deciderProvider,
              channel: form.deciderChannel,
              providerId: form.deciderProviderId,
              model: form.deciderModel,
              vision: form.deciderVision || "auto",
              apiKey: form.deciderApiKey,
              baseUrl: form.deciderBaseUrl,
              jevModel: form.jevModel,
              customModelId: form.deciderCustomId || "",
            },
            review: {
              provider: form.reviewProvider,
              model: form.reviewProvider === "jev" ? form.reviewModel : normalizeFreeModel(form.reviewModel),
              apiKey: form.reviewApiKey,
              customModelId: form.reviewProvider === "custom" ? form.reviewCustomId || "" : "",
            },
            segmentation: {
              engine: form.segmentEngine || "yolo",
              customModelId: form.segmentEngine === "custom" ? form.segmentCustomId || "" : "",
              conf: Number(form.conf) || 0.25,
              metalConf: Number(form.metalConf) || 0.2,
              metalEnabled: Boolean(form.metalEnabled),
            },
            llmEstimate: {
              enabled: Boolean(form.llmEstimateEnabled),
              role: form.llmEstimateRole || "extra",
              model: form.llmEstimateModel || "",
              customModelId: form.estimateCustomId || "",
            },
            customModels: customLibrary().map(function (item) {
              return {
                id: item.id || "",
                label: item.label || item.model || "",
                baseUrl: item.baseUrl || "",
                model: item.model || "",
                apiKey: item.apiKey || "",
                vision: Boolean(item.vision),
              };
            }),
          },
        };
        return api("/settings", { method: "POST", body: payload }).catch(function () {
          return null;
        });
      }

      function start() {
        if (!form || ui.busy) return;
        if (!form.imagePath) {
          setUi({ error2: "请先选择一张家具图片。" });
          return;
        }
        setUi({ busy: true, error2: null, payload: null, llmEstimate: null, events: [], artifacts: [], job: null });
        persistSettings()
          .then(function () {
            return api("/jobs", {
              method: "POST",
              body: {
                job: {
                  imagePath: form.imagePath,
                  category: form.category,
                  dimensions: { width: Number(form.width), height: Number(form.height), depth: Number(form.depth), unit: form.unit },
                  massKg: Number(form.massKg) || undefined,
                  volumeM3: Number(form.volumeM3) || undefined,
                  volumeKind: form.volumeKind,
                  useFireprediction: Boolean(form.useFireprediction),
                  llmEstimate: {
                    enabled: Boolean(form.llmEstimateEnabled),
                    role: form.llmEstimateRole || "extra",
                    model: form.llmEstimateModel || "",
                  },
                  device: form.device,
                  decider: {
                    provider: form.deciderProvider,
                    channel: form.deciderChannel,
                    providerId: form.deciderProviderId,
                    model: form.deciderProvider === "free-vision" ? normalizeFreeModel(form.deciderModel) : form.deciderModel,
                    vision: form.deciderVision || "auto",
                    apiKey: form.deciderApiKey,
                    baseUrl: form.deciderBaseUrl,
                    jevModel: form.jevModel,
                    customModelId: form.deciderProvider === "custom" ? form.deciderCustomId || "" : "",
                    reviewProvider: form.reviewProvider,
                    reviewModel: form.reviewProvider === "jev" ? form.reviewModel : normalizeFreeModel(form.reviewModel),
                    reviewApiKey: form.reviewApiKey,
                    reviewCustomModelId: form.reviewProvider === "custom" ? form.reviewCustomId || "" : "",
                  },
                  segmentation: {
                    engine: form.segmentEngine || "yolo",
                    customModelId: form.segmentEngine === "custom" ? form.segmentCustomId || "" : "",
                    conf: Number(form.conf) || 0.25,
                    metalConf: Number(form.metalConf) || 0.2,
                    metalEnabled: Boolean(form.metalEnabled),
                  },
                  llmEstimate: {
                    enabled: Boolean(form.llmEstimateEnabled),
                    role: form.llmEstimateRole || "extra",
                    model: form.llmEstimateModel || "",
                    customModelId: form.llmEstimateEnabled ? form.estimateCustomId || "" : "",
                  },
                },
              },
            });
          })
          .then(function (body) {
            setUi({ busy: false, job: body.job, events: [{ at: Date.now(), stage: "queue", message: "任务已提交。" }] });
          })
          .catch(function (error) {
            setUi({ busy: false, error2: String(error.message || error) });
          });
      }

      function cancel() {
        var job = ui.job;
        if (!job) return;
        api("/cancel", { method: "POST", body: { id: job.id } })
          .then(function () {
            setUi({ job: Object.assign({}, job, { state: "cancelled" }) });
          })
          .catch(function (error) {
            setUi({ error2: String(error.message || error) });
          });
      }

      function runSelfCheck() {
        setUi({ selfCheck: { status: "running", text: "正在探测 Python 与工具目录…" } });
        api("/selfcheck", { method: "POST" })
          .then(function (body) {
            var report = body.report || {};
            var checks = report.checks || {};
            var client = checks.client || {};
            var pythonChecks = checks.python || {};
            var text = [
              "client: " + (client.ok ? "ok" : client.error || "failed"),
              "python: " + (pythonChecks.ok ? "ok" : pythonChecks.error || "failed"),
              "report: " + (report.reportPath || "—"),
            ].join(" · ");
            setUi({ selfCheck: { status: body.status || "ok", text: text } });
          })
          .catch(function (error) {
            setUi({ selfCheck: { status: "failed", text: String(error.message || error) } });
          });
      }

      function fileUrl(name) {
        var job = ui.job;
        if (!job || !job.id) return "#";
        return API + "/file?id=" + encodeURIComponent(job.id) + "&name=" + encodeURIComponent(name);
      }

      if (!form) {
        return h(
          "div",
          { className: "ffx-root", "data-dsh-plugin": PANEL_ID },
          h("div", { className: "ffx-top" }, h("div", { className: "ffx-title" }, "家具火灾荷载工作台"), h("div", { className: "ffx-spacer" }), ui.error ? h("span", { className: "ffx-chip err" }, "接口不可用") : h("span", { className: "ffx-chip run" }, "加载中…")),
          h("div", { className: "ffx-empty" }, ui.error ? "无法连接插件后端：" + ui.error : "正在加载工作台…"),
        );
      }

      var payload = ui.payload;
      var physical = (payload && payload.physical) || null;
      var composition = (payload && payload.composition) || null;
      var fireLoad = (payload && payload.fireLoad) || null;
      var segmentation = (payload && payload.segmentation) || null;
      var segmentationLlm = (segmentation && segmentation.llm) || null;
      var segmentationIsLlm = Boolean(segmentation && segmentation.source === "llm");
      var segmentationLlmBox = segmentationLlm && segmentationLlm.target ? segmentationLlm.target : null;
      var llmSegFallback = "";
      var llmSegState = ui.llmSegmentation || (ui.job && ui.job.llmSegmentation) || null;
      if (llmSegState && llmSegState.error) {
        llmSegFallback = String(llmSegState.error);
      }
      var review = (payload && payload.review) || null;
  var reviewModelRaw = review && review.metadata ? String(review.metadata.model || "") : "";
  // Offline placeholders are not a real vision model: show them as "not reviewed".
  var reviewModel = /offline-unknown|stub-decider|passive/i.test(reviewModelRaw) ? "" : reviewModelRaw;
  var reviewStatus = review ? String(review.status || "") : "";
  var reviewLabel = reviewModel
    ? reviewModel
    : reviewStatus && reviewStatus !== "not_requested" && reviewStatus !== "complete"
      ? "未完成（" + reviewStatus + "）"
      : "本机 YOLO（未复核）";
  var inputDecider = (payload && payload.input && payload.input.decider) || {};
  var deciderProviderUsed = String(inputDecider.provider || form.deciderProvider || "");
  var DECIDER_PROVIDER_LABELS = { deepseek: "DeepSeek", jev: "JEV", "free-vision": "免费视觉", none: "不判定" };
  var deciderLabel = DECIDER_PROVIDER_LABELS[deciderProviderUsed] || deciderProviderUsed || "不判定";
  var deciderDetail = deciderProviderUsed === "none" ? "本次不做构造判定，全部按未知处理" : "本次用于材质组合判定" + (inputDecider.model ? "：" + String(inputDecider.model) : "（宿主默认模型）");
      var status = (payload && payload.status) || null;
      var massValue = physical && physical.mass && physical.mass.value_kg;
      var volumeValue = physical && physical.volume && physical.volume.value_m3;
      var bulkDensity = physical && physical.derived && physical.derived.bulk_density_kg_m3;
      var materialDensity = composition ? composition.materialDensityKgM3 : null;
      if (materialDensity == null && volumeValue > 0 && massValue > 0) {
        // Fallback: mass / (envelope volume - void), the density the constraint compares.
        var voidMean = composition && composition.voidFraction ? Number(composition.voidFraction.mean) : null;
        if (Number.isFinite(voidMean) && voidMean >= 0 && voidMean < 1) {
          materialDensity = Number(massValue) / (Number(volumeValue) * (1 - voidMean));
        }
      }
      var bboxValue = physical && physical.volume && physical.volume.bbox_m3;
      var heatValue = fireLoad && fireLoad.totalHeatMj ? fireLoad.totalHeatMj / (Number(massValue) || 1) : null;
      var decisionText = composition && composition.decision ? String(composition.decision.choice || "unknown") : "—";

      var providers = ui.models || [];
      var providerGroup = providers.find(function (item) {
        return item.id === form.deciderProviderId;
      }) || providers[0];
      var providerModels = (providerGroup && providerGroup.models) || [];

      function broadLabel(key) {
        return BROAD_LABELS[key] || key;
      }

      var materialRows = (composition && composition.materials) || [];
      var heatRows = (fireLoad && fireLoad.materials) || [];
      var partRows = (segmentation && segmentation.parts) || [];
      var broadShares = (composition && composition.broadMassFractions) || {};
      var materialMassSum = materialRows.reduce(function (sum, row) {
        return sum + (Number(row.massFraction) || 0);
      }, 0);
      var materialMassKgSum = materialRows.reduce(function (sum, row) {
        return sum + (Number(row.estimatedMassKg) || 0);
      }, 0);
      var refinementGroups = (composition && composition.refinementStage && composition.refinementStage.groups) || [];
      var broadShareSum = refinementGroups.reduce(function (sum, group) {
        return sum + (Number(broadShares[group.broad]) || 0);
      }, 0);
      var heatTotalRows = fireLoad && fireLoad.materialCount ? Number(fireLoad.materialCount) || heatRows.length : heatRows.length + (Number(fireLoad && fireLoad.omittedMaterials) || 0);
      var omittedHeatRows = Math.max(0, heatTotalRows - heatRows.length);
      var heatBasisLabel = (fireLoad && fireLoad.heatBasisLabel) || (heatRows.length ? "原表未说明" : "未计算");
      var heatMixedBasis = Boolean(fireLoad && fireLoad.mixedHeatBasis);
      var llmEstimate = ui.llmEstimate;
      var llmEstimateActive = Boolean(llmEstimate) || Boolean(ui.job && ui.job.input && ui.job.input.llmEstimate && ui.job.input.llmEstimate !== "off");
      var estimateDiff = function (estimateValue, actualValue) {
        var base = Number(estimateValue);
        var actual = Number(actualValue);
        if (!Number.isFinite(base) || !Number.isFinite(actual) || base <= 0 || actual <= 0) return null;
        return ((actual - base) / base) * 100;
      };
      var estimateMassDiff = llmEstimate ? estimateDiff(llmEstimate.massKg, massValue) : null;
      var estimateHeatDiff = llmEstimate ? estimateDiff(llmEstimate.fireLoadMj, fireLoad && fireLoad.totalHeatMj) : null;
      var estimateMaterialRows = (llmEstimate && llmEstimate.materials) || [];

      return h(
        "div",
        { className: "ffx-root", "data-dsh-plugin": PANEL_ID },
        h(
          "div",
          { className: "ffx-top" },
          h("div", null, h("div", { className: "ffx-title" }, "家具火灾荷载工作台"), h("div", { className: "ffx-sub" }, "Fireprediction 重量/体积 → 本机材质分割 → 判定模型选构造 → 单件火灾荷载")),
          h(
            "div",
            { className: "ffx-tabs" },
            h("button", { type: "button", className: "ffx-tab" + (view === "single" ? " active" : ""), onClick: function () { setView("single"); } }, "单件分析"),
            h("button", { type: "button", className: "ffx-tab" + (view === "batch" ? " active" : ""), onClick: function () { setView("batch"); } }, "批量分析"),
          ),
          h("div", { className: "ffx-spacer" }),
          ui.job ? h("span", { className: "ffx-chip" }, (ui.job.headline || ui.job.state) + (ui.job.elapsedMs ? " · " + fmtClock(ui.job.elapsedMs) : "")) : null,
          statusChip(ui.job),
          h("button", { className: "ffx-btn", onClick: runSelfCheck, disabled: ui.selfCheck && ui.selfCheck.status === "running" }, "环境自检"),
        ),
        view === "batch"
          ? h("div", { className: "ffx-body is-batch" }, h(BatchView, { form: form }))
          : h(
          "div",
          { className: "ffx-body" },
          h(
            "div",
            { className: "ffx-left" },
            h(
              Section,
              { title: "1 图片" },
            ),
            h(
              "div",
              { className: "ffx-drop", onClick: function (event) { var input = event.currentTarget.querySelector('input[type="file"]'); if (input) input.click(); } },
              ui.previewUrl
                ? h("img", { className: "ffx-thumb", src: ui.previewUrl, alt: "预览" })
                : h("div", { className: "ffx-thumb", style: { display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: "#999" } }, ui.uploading ? "上传中" : "无图"),
              h(
                "div",
                { style: { minWidth: 0 } },
                h("div", { className: "ffx-label", style: { fontSize: 12, color: "inherit" } }, form.imageName || "选择家具图片"),
                h("div", { className: "ffx-hint" }, "点击选择本地图片；工具会自动定位家具并识别可见材质。"),
                h("input", { type: "file", accept: "image/*", style: { display: "none" }, onChange: pickFile }),
              ),
            ),
            h(
              Section,
              { title: "2 家具与尺寸" },
            ),
            h(
              Field,
              { label: "家具类别", hint: "类别用于 Fireprediction 预测与调查先验选择。" },
              h(
                "select",
                { className: "ffx-select", value: form.category, onChange: function (event) { setForm({ category: event.target.value }); } },
                (ui.state && ui.state.categories ? ui.state.categories : ["床", "桌子", "椅子", "柜子", "沙发"]).map(function (item) {
                  return h("option", { key: item, value: item }, item);
                }),
              ),
            ),
            h(
              "div",
              { className: "ffx-row" },
              h(Field, { label: "宽" }, h("input", { className: "ffx-input", value: form.width, onChange: function (event) { setForm({ width: event.target.value }); } })),
              h(Field, { label: "高" }, h("input", { className: "ffx-input", value: form.height, onChange: function (event) { setForm({ height: event.target.value }); } })),
              h(Field, { label: "深" }, h("input", { className: "ffx-input", value: form.depth, onChange: function (event) { setForm({ depth: event.target.value }); } })),
              h(
                Field,
                { label: "单位" },
                h(
                  "select",
                  { className: "ffx-select", value: form.unit, onChange: function (event) { setForm({ unit: event.target.value }); } },
                  h("option", { value: "mm" }, "mm"),
                  h("option", { value: "cm" }, "cm"),
                  h("option", { value: "m" }, "m"),
                ),
              ),
            ),
            h(
              "label",
              { className: "ffx-toggle", style: { margin: "2px 0 10px" } },
              h("input", { type: "checkbox", checked: Boolean(form.useFireprediction), onChange: function (event) { setForm({ useFireprediction: event.target.checked }); } }),
              "用内置的 Fireprediction 训练模型预测重量与包裹体积（CPU 约 3~5 秒/件）",
            ),
            h(
              "div",
              { className: "ffx-row" },
              h(Field, { label: "重量（kg，可覆盖预测）" }, h("input", { className: "ffx-input", value: form.massKg, placeholder: "留空则用预测值", onChange: function (event) { setForm({ massKg: event.target.value }); } })),
              h(Field, { label: "体积（m³，可覆盖预测）" }, h("input", { className: "ffx-input", value: form.volumeM3, placeholder: "留空则用预测值", onChange: function (event) { setForm({ volumeM3: event.target.value }); } })),
            ),
            h(
              Field,
              { label: "体积口径", hint: "Fireprediction 给的是包裹体积（含空腔）；若填材料占据体积请在此切换。" },
              h(
                "select",
                { className: "ffx-select", value: form.volumeKind, onChange: function (event) { setForm({ volumeKind: event.target.value }); } },
                ((ui.state && ui.state.volumeKinds) || [{ id: "envelope", label: "包裹体积（含空腔）" }]).map(function (item) {
                  return h("option", { key: item.id, value: item.id }, item.label);
                }),
              ),
            ),
            h(
              Section,
              { title: "0 自定义模型", badge: customLibrary().length ? customLibrary().length + " 个" : null, tone: "ok" },
            ),
            h(
              "div",
              { className: "ffx-note", style: { marginBottom: 8 } },
              "在这里保存常用的 OpenAI 兼容模型（API 地址 + 模型名 + 密钥）。保存后，「判定模型 / 材质区域识别 / LLM 直接估计」都会把它们直接列成可选项，可以按步骤挑不同模型。",
            ),
            h(
              "div",
              { className: "ffx-row" },
              h(
                Field,
                { label: "模型库" },
                h("button", { type: "button", className: "ffx-btn", onClick: function () { setForm({ customOpen: !form.customOpen }); } }, form.customOpen ? "收起模型库" : "编辑模型库"),
              ),
              h(
                Field,
                { label: "添加" },
                h("button", { type: "button", className: "ffx-btn", onClick: addCustomModel }, "添加一个模型"),
              ),
            ),
            form.customOpen
              ? h(
                  "div",
                  null,
                  customRows().length === 0
                    ? h("div", { className: "ffx-note" }, "还没有自定义模型：点「添加一个模型」，填地址、模型名与密钥，保存后即可在各步骤里选择。")
                    : null,
                  customRows().map(function (item, index) {
                    return h(
                      "div",
                      { key: item.id || "custom-" + index, className: "ffx-custom" },
                      h(
                        "div",
                        { className: "ffx-row" },
                        h(Field, { label: "名称" }, h("input", { className: "ffx-input", value: item.label || "", onChange: function (event) { patchCustomAt(index, { label: event.target.value }); } })),
                        h(
                          Field,
                          { label: "模型名", hint: "例如 deepseek-chat、openai/gpt-4o-mini、qwen/qwen2.5-vl-72b-instruct。" },
                          h("input", { className: "ffx-input", value: item.model || "", placeholder: "deepseek-chat", onChange: function (event) { patchCustomAt(index, { model: event.target.value }); } }),
                        ),
                      ),
                      h(
                        "div",
                        { className: "ffx-row" },
                        h(
                          Field,
                          { label: "API 地址", hint: "会自动补 /chat/completions。" },
                          h("input", { className: "ffx-input", value: item.baseUrl || "", placeholder: "https://api.deepseek.com", onChange: function (event) { patchCustomAt(index, { baseUrl: event.target.value }); } }),
                        ),
                        h(
                          Field,
                          { label: "API 密钥", hint: "保存在本机插件数据目录。" },
                          h("input", { className: "ffx-input", type: "password", value: item.apiKey || "", placeholder: "sk-…", onChange: function (event) { patchCustomAt(index, { apiKey: event.target.value }); } }),
                        ),
                      ),
                      h(
                        "div",
                        { className: "ffx-row" },
                        h(
                          "label",
                          { className: "ffx-toggle" },
                          h("input", { type: "checkbox", checked: Boolean(item.vision), onChange: function (event) { patchCustomAt(index, { vision: event.target.checked }); } }),
                          "支持图片输入（视觉模型）",
                        ),
                        h("button", { type: "button", className: "ffx-btn", onClick: function () { removeCustomAt(index); } }, "删除"),
                      ),
                    );
                  }),
                )
              : null,
            h(
              Section,
              { title: "3 判定模型", badge: form.deciderProvider === "deepseek" || form.deciderProvider === "custom" ? "可切换" : null, tone: "ok" },
            ),
            h(
              Field,
              {
                label: "材质组合判定（原 JEV / Decider 节点）",
                hint: "和下面几步一样，直接在这个下拉里挑模型：宿主模型、自定义模型（连同地址与密钥），或 OpenRouter 的免费视觉 / JEV。要直连别的 API，先到「0 自定义模型」加一条。",
              },
              h(
                "select",
                { className: "ffx-select", value: deciderSelectValue(), onChange: function (event) { changeDeciderSelect(event.target.value); } },
                h("option", { value: "host:auto" }, "宿主模型（自动选择）" + (ui.modelsError ? " — 模型列表不可用" : "")),
                hostModelGroups().map(function (group) {
                  return h(
                    "optgroup",
                    { key: "host-" + group.id, label: "宿主模型 · " + group.label },
                    group.models.map(function (item) {
                      return h(
                        "option",
                        { key: "host-" + group.id + "-" + item.id, value: "host:" + group.id + "|" + item.id },
                        (item.label || item.id) + (item.vision ? " · 支持图片" : ""),
                      );
                    }),
                  );
                }),
                customLibrary().length
                  ? h(
                      "optgroup",
                      { label: "自定义模型" },
                      customLibrary().map(function (item) {
                        return h("option", { key: "dec-" + item.id, value: "custom:" + item.id }, (item.label || item.model) + "（" + item.model + "）" + (item.vision ? " · 支持图片" : ""));
                      }),
                    )
                  : null,
                h("option", { value: "free-vision" }, "免费视觉模型（OpenRouter，需密钥）"),
                h("option", { value: "jev" }, "JEV / Decider（OpenRouter，需密钥）"),
                h("option", { value: "none" }, "不判定（全部按未知）"),
              ),
            ),
            form.deciderProvider === "custom" && findCustom(form.deciderCustomId)
              ? h(
                  "div",
                  { className: "ffx-note", style: { marginBottom: 8 } },
                  "判定将请求：" + findCustom(form.deciderCustomId).model + " @ " + (findCustom(form.deciderCustomId).baseUrl || "未填地址") + (findCustom(form.deciderCustomId).vision ? "（会附带图片）" : "（只发文字证据）"),
                )
              : null,
            form.deciderProvider === "deepseek"
              ? h(
                  Field,
                  {
                    label: "图像输入",
                    hint:
                      form.deciderVision === "off"
                        ? "只发送文字证据（分割比例、候选构造）。"
                        : "所选模型接受图片时随判定一起发送；纯文本模型会自动改走视觉通道（如 DeepSeek (modlens vision)）。",
                  },
                  h(
                    "select",
                    { className: "ffx-select", value: form.deciderVision || "auto", onChange: function (event) { setForm({ deciderVision: event.target.value }); } },
                    h("option", { value: "auto" }, "自动：模型支持图片就附带"),
                    h("option", { value: "off" }, "关闭：只发送文字证据"),
                  ),
                )
              : null,
            form.deciderProvider === "jev"
              ? h(
                  Field,
                  { label: "JEV 模型名" },
                  h("input", { className: "ffx-input", value: form.jevModel, onChange: function (event) { setForm({ jevModel: event.target.value }); } }),
                )
              : null,
            form.deciderProvider === "free-vision"
              ? h(
                  Field,
                  { label: "免费视觉模型名", hint: "必须是以 :free 结尾的免费模型；留空则用 nvidia/nemotron-3.5-super-vl:free。" },
                  h("input", {
                    className: "ffx-input",
                    value: form.deciderModel,
                    placeholder: "nvidia/nemotron-3.5-super-vl:free",
                    onChange: function (event) { setForm({ deciderModel: event.target.value }); },
                    onBlur: function (event) { setForm({ deciderModel: normalizeFreeModel(event.target.value) }); },
                  }),
                )
              : null,
            h(
              Section,
              { title: "4 LLM 直接估计", badge: form.llmEstimateEnabled ? "已开启" : null, tone: "ok" },
            ),
            h(
              "label",
              { className: "ffx-toggle", style: { marginBottom: 8 } },
              h("input", {
                type: "checkbox",
                checked: Boolean(form.llmEstimateEnabled),
                onChange: function (event) { setForm({ llmEstimateEnabled: event.target.checked }); },
              }),
              "额外用 LLM 直接从图片预测重量与火灾荷载",
            ),
            form.llmEstimateEnabled
              ? h(
                  "div",
                  null,
                  h(
                    Field,
                    { label: "估计结果的用途", hint: "额外对照：只做对比，不改流程数值；作为物理量输入：没有手工质量/体积时用它替代 Fireprediction。" },
                    h(
                      "select",
                      { className: "ffx-select", value: form.llmEstimateRole, onChange: function (event) { setForm({ llmEstimateRole: event.target.value }); } },
                      h("option", { value: "extra" }, "额外对照（不改主流程数值）"),
                      h("option", { value: "primary" }, "作为物理量输入（替代 Fireprediction）"),
                    ),
                  ),
                  h(
                    Field,
                    {
                      label: "估计用模型",
                      hint:
                        form.estimateCustomId && findCustom(form.estimateCustomId)
                          ? "将请求：" + findCustom(form.estimateCustomId).model + " @ " + (findCustom(form.estimateCustomId).baseUrl || "未填地址") + "（需要能看图）"
                          : "默认沿用「判定模型」；纯文本模型会自动改走视觉通道（modlens 视觉桥）。也可在「0 自定义模型」里加模型后直接选。",
                    },
                    h(
                      "select",
                      {
                        className: "ffx-select",
                        value: form.estimateCustomId ? "custom:" + form.estimateCustomId : "",
                        onChange: function (event) {
                          var value = event.target.value;
                          if (value.indexOf("custom:") === 0) setForm({ estimateCustomId: value.slice(7), llmEstimateModel: "" });
                          else setForm({ estimateCustomId: "", llmEstimateModel: "" });
                        },
                      },
                      h("option", { value: "" }, "与判定模型一致（宿主模型）"),
                      customLibrary().length === 0 ? null : h("optgroup", { label: "自定义模型" },
                        customLibrary().map(function (item) {
                          return h("option", { key: "est-" + item.id, value: "custom:" + item.id }, (item.label || item.model) + "（" + item.model + "）" + (item.vision ? " · 支持图片" : ""));
                        }),
                      ),
                    ),
                  ),
                )
              : null,
            h(
              Section,
              { title: "5 材质区域识别", badge: form.segmentEngine === "llm" || form.segmentEngine === "custom" ? "大模型" : null, tone: "ok" },
            ),
            h(
              Field,
              {
                label: "怎么找出可见材质",
                hint:
                  form.segmentEngine === "llm"
                    ? "由视觉模型同时给出家具包围框和照片里可见材质的面积占比；不做本机分割，也不做逐区域复核。失败会自动回退到本机 YOLO。"
                    : form.segmentEngine === "custom"
                      ? "由你在「0 自定义模型」里配置的模型给出包围框与材质面积占比（需要支持图片输入）。失败会自动回退到本机 YOLO。"
                      : "本机 YOLO 分割成可见材质区域，再按「视觉复核」决定是否让模型复核这些区域。",
              },
              h(
                "select",
                {
                  className: "ffx-select",
                  value: form.segmentEngine === "custom" ? "custom:" + (form.segmentCustomId || "") : form.segmentEngine,
                  onChange: function (event) {
                    var value = event.target.value;
                    if (value.indexOf("custom:") === 0) setForm({ segmentEngine: "custom", segmentCustomId: value.slice(7) });
                    else setForm({ segmentEngine: value, segmentCustomId: "" });
                  },
                },
                h("option", { value: "yolo" }, "本机 YOLO 分割（默认）"),
                h("option", { value: "llm" }, "宿主模型直接判定材质与区域（不用 YOLO）"),
                customLibrary().length === 0 ? null : h("optgroup", { label: "自定义模型" },
                  customLibrary().map(function (item) {
                    return h("option", { key: "seg-" + item.id, value: "custom:" + item.id }, (item.label || item.model) + "（" + item.model + "）" + (item.vision ? " · 支持图片" : ""));
                  }),
                ),
              ),
            ),
            form.segmentEngine === "custom" && findCustom(form.segmentCustomId) && !findCustom(form.segmentCustomId).vision
              ? h("div", { className: "ffx-note", style: { marginBottom: 8 } }, "提示：这个自定义模型没有勾选「支持图片输入」，大概率无法看图；请回到「0 自定义模型」确认或换一个视觉模型。")
              : null,
            form.segmentEngine === "llm"
              ? h(
                  "div",
                  { className: "ffx-note", style: { marginBottom: 8 } },
                  "大模型模式：目标框与各类材质面积占比都由「判定模型」里选的模型（需能看图，例如 DeepSeek-V4-Pro (modlens vision)）给出；包围框不再手工框选；模型给的大类只能是织物/木材/塑料/玻璃/金属，其余会被忽略。批量模式仍用本机 YOLO。",
                )
              : null,
            h(
              Section,
              { title: "6 视觉复核" },
            ),
            form.segmentEngine === "llm"
              ? h(
                  "div",
                  { className: "ffx-note", style: { marginBottom: 8 } },
                  "当前是大模型直接判定模式：不做本机分割，因此也没有逐区域复核；下面这些设置只在「本机 YOLO 分割」时生效。",
                )
              : null,
            h(
              Field,
              {
                label: "可见材质/类别复核",
                hint: "和「判定模型」一样的选法：宿主/自定义模型直接挑，或走路由 OpenRouter 的免费视觉 / JEV；也可以只做本机分割、不联网复核。",
              },
              h(
                "select",
                { className: "ffx-select", value: reviewSelectValue(), onChange: function (event) { changeReviewSelect(event.target.value); } },
                h("option", { value: "auto" }, "自动（有 OpenRouter 密钥才联网）"),
                h("option", { value: "jev" }, "JEV / Decider（OpenRouter）"),
                customLibrary().length
                  ? h(
                      "optgroup",
                      { label: "自定义模型" },
                      customLibrary().map(function (item) {
                        return h("option", { key: "rev-" + item.id, value: "custom:" + item.id }, (item.label || item.model) + "（" + item.model + "）" + (item.vision ? " · 支持图片" : ""));
                      }),
                    )
                  : null,
                h("option", { value: "off" }, "不联网（仅本机分割）"),
              ),
            ),
            form.reviewProvider === "custom" && findCustom(form.reviewCustomId)
              ? h(
                  "div",
                  { className: "ffx-note", style: { marginBottom: 8 } },
                  "复核将请求：" + findCustom(form.reviewCustomId).model + " @ " + (findCustom(form.reviewCustomId).baseUrl || "未填地址") + (findCustom(form.reviewCustomId).vision ? "（会附带图片）" : "（未勾选支持图片，可能无法看图）"),
                )
              : null,
            form.reviewProvider === "auto" || form.reviewProvider === "openrouter-free" || form.reviewProvider === "jev"
              ? h(
                  "div",
                  null,
                  h(
                    Field,
                    { label: "OpenRouter 密钥", hint: "用于免费视觉模型或 JEV；留空则读环境变量 OPENROUTER_API_KEY。" },
                    h("input", { className: "ffx-input", type: "password", value: form.reviewApiKey, placeholder: "sk-or-…", onChange: function (event) { setForm({ reviewApiKey: event.target.value }); } }),
                  ),
                  form.reviewProvider === "auto" || form.reviewProvider === "openrouter-free"
                    ? h(
                        Field,
                        { label: "视觉模型", hint: "免费视觉模型必须以 :free 结尾；留空则用 nvidia/nemotron-3.5-super-vl:free。" },
                        h("input", {
                          className: "ffx-input",
                          value: form.reviewModel,
                          placeholder: "nvidia/nemotron-3.5-super-vl:free",
                          onChange: function (event) { setForm({ reviewModel: event.target.value }); },
                          onBlur: function (event) { setForm({ reviewModel: normalizeFreeModel(event.target.value) }); },
                        }),
                      )
                    : null,
                )
              : null,
            h(
              "button",
              { className: "ffx-btn", style: { marginBottom: 8 }, onClick: function () { setUi({ advanced: !ui.advanced }); } },
              ui.advanced ? "收起高级设置" : "展开高级设置",
            ),
            ui.advanced
              ? h(
                  "div",
                  null,
                  h(
                    "div",
                    { className: "ffx-row" },
                    h(Field, { label: "材质阈值" }, h("input", { className: "ffx-input", value: form.conf, onChange: function (event) { setForm({ conf: event.target.value }); } })),
                    h(Field, { label: "金属阈值" }, h("input", { className: "ffx-input", value: form.metalConf, onChange: function (event) { setForm({ metalConf: event.target.value }); } })),
                    h(
                      Field,
                      { label: "设备" },
                      h(
                        "select",
                        { className: "ffx-select", value: form.device, onChange: function (event) { setForm({ device: event.target.value }); } },
                        h("option", { value: "auto" }, "自动"),
                        h("option", { value: "cpu" }, "CPU"),
                      ),
                    ),
                  ),
                  h(
                    "label",
                    { className: "ffx-toggle", style: { marginBottom: 10 } },
                    h("input", { type: "checkbox", checked: Boolean(form.metalEnabled), onChange: function (event) { setForm({ metalEnabled: event.target.checked }); } }),
                    "启用金属辅助分割",
                  ),
                  ui.state && ui.state.paths
                    ? h(
                        "div",
                        { className: "ffx-kv", style: { marginBottom: 10 } },
                        h("b", null, "Python"),
                        h("span", { title: ui.state.paths.python.path }, (ui.state.paths.python.exists ? "✓ " : "✗ ") + basename(ui.state.paths.python.path)),
                        h("b", null, "材质模块"),
                        h(
                          "span",
                          { title: ui.state.paths.toolA.path },
                          ui.state.paths.toolA.exists
                            ? ui.state.paths.toolA.builtin
                              ? "✓ 内置"
                              : "✓ 已找到"
                            : "✗ 缺失",
                        ),
                        h("b", null, "Fireprediction"),
                        h(
                          "span",
                          { title: ui.state.paths.toolB.path || "未检测到" },
                          ui.state.paths.toolB.exists
                            ? ui.state.paths.toolB.builtin
                              ? "✓ 内置训练模型"
                              : "✓ 已找到（外部目录）"
                            : "✗ 未检测到",
                        ),
                        ui.state.paths.toolB.exists
                          ? null
                          : h(
                              "span",
                              { className: "ffx-note", style: { gridColumn: "1 / -1" } },
                              "Fireprediction 不可用时，质量与体积会改用视觉模型直接估计（也可以手工填写）。",
                            ),
                      )
                    : null,
                )
              : null,
            h(
              "div",
              { className: "ffx-actions", style: { marginTop: 6 } },
              h("button", { className: "ffx-btn ffx-btn-primary", onClick: start, disabled: ui.busy || running }, running ? "分析中…" : ui.busy ? "提交中…" : "开始分析"),
              running ? h("button", { className: "ffx-btn", onClick: cancel }, "取消") : null,
              ui.job && !running ? h("button", { className: "ffx-btn", onClick: start }, "重新运行") : null,
            ),
            ui.error2 ? h("div", { className: "ffx-error" }, ui.error2) : null,
            ui.selfCheck ? h("div", { className: "ffx-hint", style: { marginTop: 8 } }, "自检：" + String(ui.selfCheck.text || ui.selfCheck.status || "")) : null,
          ),
          h(
            "div",
            { className: "ffx-right" },
            payload
              ? h(
                  "div",
                  { className: "ffx-flow" },
                  h(
                    "div",
                    { className: "ffx-flowrow top" },
                    h(
                      Card,
                      { index: 1, title: "家具类别 · 尺寸 · 图片" },
                      h(
                        "div",
                        { className: "ffx-kv" },
                        h("b", null, "图片"),
                        h("span", null, (payload.input && payload.input.imageName) || form.imageName || "—"),
                        h("b", null, "类别"),
                        h("span", null, (payload.input && payload.input.category) || form.category),
                        h("b", null, "包围盒"),
                        h("span", null, [payload.input && payload.input.dimensions ? [payload.input.dimensions.width, payload.input.dimensions.height, payload.input.dimensions.depth].join(" × ") + " " + payload.input.dimensions.unit : "—"]),
                        h("b", null, "分割"),
                        h(
                          "span",
                          null,
                          !segmentation
                            ? "—"
                            : segmentationIsLlm
                              ? "视觉模型判定 " +
                                ((segmentationLlm && segmentationLlm.materials) || []).length +
                                " 类材质 · 已知占比 " +
                                pct(segmentation.statistics && segmentation.statistics.known_ratio, 1)
                              : partRows.length + " 个可见材质区域 · 已知占比 " + pct(segmentation.statistics && segmentation.statistics.known_ratio, 1)
                        ),
                        segmentationIsLlm && segmentationLlmBox
                          ? h("b", null, "目标框")
                          : null,
                        segmentationIsLlm && segmentationLlmBox
                          ? h(
                              "span",
                              { title: "视觉模型给出的家具包围框（相对整张图片的比例）" },
                              "x " + pct(segmentationLlmBox.x0, 0) + "–" + pct(segmentationLlmBox.x1, 0) + " · y " + pct(segmentationLlmBox.y0, 0) + "–" + pct(segmentationLlmBox.y1, 0)
                            )
                          : null,
                      ),
                      h(
                        "div",
                        { className: "ffx-card-t", style: { marginTop: 2 } },
                        h(
                          "span",
                          {
                            className: "ffx-chip",
                            title: segmentationIsLlm
                              ? "本次关闭了本机 YOLO：目标框与可见材质占比都由视觉模型直接给出，没有逐区域复核"
                              : "本机 YOLO 找可见材质；启用「可见材质/类别复核」时再调用视觉模型复核",
                          },
                          "视觉复核：" + (segmentationIsLlm ? "大模型直接判定（未做本机分割）" : reviewLabel),
                        ),
                        h(
                          "span",
                          { className: "ffx-chip " + (deciderProviderUsed === "deepseek" ? "ok" : ""), title: deciderDetail },
                          "判定：" + deciderLabel,
                        ),
                        llmSegFallback
                          ? h(
                              "span",
                              { className: "ffx-chip warn", title: llmSegFallback },
                              "区域识别：已回退本机 YOLO",
                            )
                          : null,
                      ),
                      h(
                        "div",
                        { className: "ffx-note", style: { marginTop: 2 } },
                        segmentationIsLlm
                          ? "本次可见材质面积占比由视觉模型直接判断（没有本机分割与逐区域复核）：隐藏结构、内部填充不在可见占比里，仍由构造先验与密度约束补全。"
                          : "分割的「已知占比」只统计照片里能看清的材质面积，其余靠判定模型与频次先验补全。",
                      ),
                    ),
                    h(
                      Card,
                      {
                        index: 2,
                        title: "物理量来源",
                        right: h(
                          "span",
                          { className: "ffx-chip" },
                          physicalSourceLabel(payload.physicalSource),
                        ),
                      },
                      physical && physical.association
                        ? h(
                            "div",
                            null,
                            h(
                              "div",
                              { className: "ffx-kv" },
                              h("b", { title: "这条质量/体积记录是怎么和图片绑定的" }, "关联"),
                              h("span", { title: "verified_sha256：用图片 SHA256 匹配到 Fireprediction 的记录；manual_input：手工填写" }, String(physical.association.state || "—")),
                              h("b", { title: "外包围盒 宽×高×深" }, "包围盒体积"),
                              h("span", null, num(bboxValue, 3) + " m³"),
                              h("b", { title: "包裹体积里属于空腔（材料之外）的比例" }, "空腔占比"),
                              h("span", null, composition && composition.voidFraction ? pct(composition.voidFraction.mean, 1) : "—"),
                            ),
                            h(
                              "div",
                              { className: "ffx-note", style: { marginTop: 2 } },
                              "关联=" + (String(physical.association.state || "") === "verified_sha256" ? "按图片 SHA256 对上 Fireprediction 记录" : String(physical.association.state || "—")) +
                                "；空腔占比指包裹体积里除材料以外的那部分（平均密度用的是包裹体积）。",
                            ),
                          )
                        : h("div", { className: "ffx-note" }, "未取得质量与体积：可以补填手工值，或启用 Fireprediction 预测。"),
                    ),
                  ),
                  h(
                    "div",
                    { className: "ffx-flowrow mid" },
                    h(
                      Card,
                      { index: 3, title: "家具重量" },
                      h(Value, { value: num(massValue, 2), unit: "kg" }),
                      h("div", { className: "ffx-note" }, physical && physical.mass ? "状态：" + String(physical.mass.status || "—") : "待输入或预测"),
                    ),
                    h(
                      Card,
                      { index: 4, title: "家具真实体积" },
                      h(Value, { value: num(volumeValue, 3), unit: "m³" }),
                      h("div", { className: "ffx-note" }, physical && physical.volume ? (physical.volume.kind === "envelope" ? "包裹体积（含空腔）" : "材料占据体积") : "待输入或预测"),
                    ),
                    h(
                      Card,
                      { index: 5, title: "密度" },
                      h(
                        "div",
                        { className: "ffx-duo" },
                        h(
                          "div",
                          { className: "ffx-duo-cell" },
                          h("div", { className: "ffx-duo-label" }, "平均密度（含空腔）"),
                          h(
                            "div",
                            { className: "ffx-duo-value" },
                            num(bulkDensity, 1),
                            h("span", { className: "ffx-duo-unit" }, "kg/m³"),
                          ),
                        ),
                        h(
                          "div",
                          { className: "ffx-duo-cell" },
                          h("div", { className: "ffx-duo-label" }, "材料平均密度（除空腔）"),
                          h(
                            "div",
                            { className: "ffx-duo-value" },
                            materialDensity == null ? "—" : num(materialDensity, 1),
                            h("span", { className: "ffx-duo-unit" }, "kg/m³"),
                          ),
                        ),
                      ),
                    ),
                    h(
                      Card,
                      { index: 6, title: "家具材质组合", tone: composition ? "" : "ghost" },
                      h(Bars, { data: composition && composition.broadMassFractions, emptyText: "等待判定" }),
                      h(
                        "div",
                        { className: "ffx-note" },
                        "判定：" + decisionText + (composition && composition.broadStage && composition.broadStage.decision && composition.broadStage.decision.unknownScore != null ? "（未知得分 " + num(composition.broadStage.decision.unknownScore, 2) + "）" : ""),
                      ),
                    ),
                  ),
                  h(
                    "div",
                    { className: "ffx-flowrow low" },
                    h(
                      Card,
                      { index: 7, title: "家具中材质的占比" },
                      h(Table, {
                        rows: materialRows,
                        collapsible: { limit: 6, unit: " 项材质", hint: "折叠时只显示质量占比最大的 6 项，合计行始终可见。" },
                        emptyText: composition && composition.status === "materials_only" ? "未提供重量与体积：当前只给出材质候选（" + ((composition.mainMaterials || []).join("、") || "—") + "）；补充质量（或勾选 Fireprediction 预测）后才能换算质量占比。" : "等待材质细化结果",
                        footer: {
                          name: "合计",
                          broad: String(materialRows.length) + " 项",
                          massFraction: pctFine(materialMassSum),
                          estimatedMassKg: num(materialMassKgSum, 2),
                        },
                        columns: [
                          { key: "name", label: "材质" },
                          { key: "broad", label: "大类", render: function (row) { return broadLabel(row.broad); } },
                          { key: "massFraction", label: "质量占比", align: "right", render: function (row) { return pctFine(row.massFraction); } },
                          { key: "estimatedMassKg", label: "质量 kg", align: "right", render: function (row) { return num(row.estimatedMassKg, 2); } },
                        ],
                      }),
                      materialRows.length > 0 ? h("div", { className: "ffx-note" }, "质量占比 = 该材质质量 ÷ 家具总质量；全部 " + String(materialRows.length) + " 种材质合计 100%（按当前构造候选分配，属条件估计）。") : null,
                    ),
                    h(
                      Card,
                      { index: 8, title: "家具的热值" },
                      h(Value, { value: num(heatValue, 2), unit: "MJ/kg" }),
                      h("div", { className: "ffx-note" }, "按材质质量加权：Σ(mᵢ·Hᵢ) ÷ 总质量"),
                      h(
                        "div",
                        { className: "ffx-note", title: "热值取自数据表「热值口径」列，原样传递，不做 HHV↔LHV 换算；也未乘燃烧效率、保护或规范系数。" },
                        "热值口径：" + heatBasisLabel + (heatMixedBasis ? "（混合口径：不能当作统一净热值的规范设计结果）" : ""),
                      ),
                      h(Table, {
                        rows: heatRows,
                        collapsible: { limit: 5, unit: " 项材质" },
                        emptyText: "等待热值计算",
                        columns: [
                          { key: "name", label: "材质" },
                          { key: "heatValueMjKg", label: "H MJ/kg", align: "right", render: function (row) { return num(row.heatValueMjKg, 1); } },
                          { key: "heatMj", label: "热量 MJ", align: "right", render: function (row) { return num(row.heatMj, 1); } },
                        ],
                      }),
                      heatRows.length > 5 || omittedHeatRows > 0 ? h("div", { className: "ffx-note" }, "按热量降序；共 " + String(heatTotalRows) + " 项材质参与热值计算，完整清单见导出报告。") : null,
                    ),
                  ),
                  h(
                    Card,
                    {
                      index: 9,
                      title: "单个家具的火灾荷载",
                      tone: "hero",
                      right: h("span", { className: "ffx-chip " + (fireLoad && fireLoad.status === "complete" ? "ok" : fireLoad && fireLoad.status === "partial" ? "warn" : "err") }, fireLoad ? String(fireLoad.status || "unknown") : "未计算"),
                    },
                    h(
                      "div",
                      { style: { display: "flex", alignItems: "baseline", gap: 16, flexWrap: "wrap" } },
                      h(Value, { hero: true, value: fireLoad && fireLoad.totalHeatMj != null ? num(fireLoad.totalHeatMj, 1) : "—", unit: "MJ" }),
                      fireLoad && fireLoad.totalHeatIntervalMj
                        ? h("div", { className: "ffx-note" }, "区间 " + num(fireLoad.totalHeatIntervalMj[0], 1) + " – " + num(fireLoad.totalHeatIntervalMj[1], 1) + " MJ · 质量覆盖 " + pct(fireLoad.coverageMassFraction, 1) + " · 参与材质 " + String(fireLoad.materialCount || 0) + " 项")
                        : null,
                      fireLoad && fireLoad.fireLoadDensityMjM2
                        ? h("div", { className: "ffx-note" }, "火灾荷载密度 " + num(fireLoad.fireLoadDensityMjM2, 1) + " MJ/m²")
                        : h("div", { className: "ffx-note" }, "填写防火分区面积后才能换算 MJ/m²"),
                    ),
                    h("div", { className: "ffx-note" }, "Q = Σ(mᵢ × Hᵢ)，仅统计有热值来源的材质；钢等不燃材料计质量但不计热量。"),
                    h(
                      "div",
                      { className: "ffx-artifacts", style: { marginTop: 4 } },
                      h("a", { className: "ffx-link", href: fileUrl("overlay.png"), target: "_blank", rel: "noreferrer" }, "分割叠加图"),
                      h("a", { className: "ffx-link", href: fileUrl("主要材料报告.html"), target: "_blank", rel: "noreferrer" }, "材料报告（HTML）"),
                      h("a", { className: "ffx-link", href: fileUrl("主要材料统计.csv"), target: "_blank", rel: "noreferrer" }, "材料统计（CSV）"),
                      h("a", { className: "ffx-link", href: fileUrl("composition.json"), target: "_blank", rel: "noreferrer" }, "完整 JSON"),
                      h("a", { className: "ffx-link", href: fileUrl("fireprediction.json"), target: "_blank", rel: "noreferrer" }, "Fireprediction 记录"),
                    ),
                  ),
                  llmEstimateActive
                    ? h(
                        Card,
                        {
                          title: "LLM 直接估计（未校准对照）",
                          right: h(
                            "span",
                            { className: "ffx-chip " + (llmEstimate && !llmEstimate.error ? "ok" : llmEstimate ? "warn" : "run") },
                            llmEstimate ? (llmEstimate.error ? "失败" : "完成") : "运行中",
                          ),
                        },
                        llmEstimate && llmEstimate.error
                          ? h("div", { className: "ffx-note" }, "估计失败：" + String(llmEstimate.error))
                          : llmEstimate
                          ? h(
                              "div",
                              null,
                              h(
                                "div",
                                { className: "ffx-kv" },
                                h("b", null, "质量"),
                                h("span", null, (llmEstimate.massKg ? num(llmEstimate.massKg, 2) + " kg" : "—") + (estimateMassDiff == null ? "" : "（与主流程 " + (estimateMassDiff >= 0 ? "+" : "") + num(estimateMassDiff, 1) + "%）")),
                                h("b", null, "体积"),
                                h("span", null, llmEstimate.volumeM3 ? num(llmEstimate.volumeM3, 3) + " m³" : "—"),
                                h("b", null, "平均热值"),
                                h("span", null, llmEstimate.heatValueMjKg ? num(llmEstimate.heatValueMjKg, 2) + " MJ/kg" : "—"),
                                h("b", null, "火灾荷载"),
                                h("span", null, (llmEstimate.fireLoadMj ? num(llmEstimate.fireLoadMj, 1) + " MJ" : "—") + (estimateHeatDiff == null ? "" : "（与主流程 " + (estimateHeatDiff >= 0 ? "+" : "") + num(estimateHeatDiff, 1) + "%）")),
                                h("b", null, "置信度"),
                                h("span", null, llmEstimate.confidence == null ? "—" : pct(llmEstimate.confidence, 0)),
                                h("b", null, "模型"),
                                h("span", { title: llmEstimate.model }, String(llmEstimate.model || "—") + (llmEstimate.images ? " · " + String(llmEstimate.images) + " 张图" : " · 仅文本")),
                              ),
                              estimateMaterialRows.length > 0
                                ? h(
                                    "div",
                                    { className: "ffx-bars", style: { marginTop: 4 } },
                                    estimateMaterialRows.slice(0, 5).map(function (item, index) {
                                      return h(
                                        "div",
                                        { className: "ffx-bar", key: "est-" + String(index) },
                                        h("span", { className: "ffx-bar-name", title: item.name }, item.name),
                                        h("span", { className: "ffx-bar-track" }, h("span", { className: "ffx-bar-fill", style: { width: Math.max(2, Math.min(100, (Number(item.share) || 0) * 100)) + "%", background: "var(--dsw-alias-brand-primary,#4b7bec)" } })),
                                        h("span", { className: "ffx-bar-val" }, pct(item.share, 1)),
                                      );
                                    }),
                                  )
                                : null,
                              llmEstimate.notes ? h("div", { className: "ffx-note", style: { marginTop: 4 } }, "模型说明：" + llmEstimate.notes) : null,
                              h("div", { className: "ffx-note" }, "模型直接看图给出的估计，只作量级对照，未经密度/质量/体积约束校准。"),
                            )
                          : h("div", { className: "ffx-note" }, "正在让模型估计重量与火灾荷载…"),
                      )
                    : null,
                  h(
                    "div",
                    { style: { display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 10 } },
                    h(
                      Card,
                      { title: "分层细化（大类 → 具体材质）" },
                      h(Table, {
                        rows: refinementGroups.map(function (group) {
                          var top = (group.options || [])[0] || {};
                          return {
                            broad: broadLabel(group.broad),
                            share: broadShares[group.broad],
                            option: top.name || "—",
                            posterior: top.posterior,
                            mass: top.massFraction,
                          };
                        }).sort(function (a, b) { return (Number(b.share) || 0) - (Number(a.share) || 0); }),
                        collapsible: { limit: 4, unit: " 个大类", hint: "折叠时只显示大类质量占比最高的 4 个大类。" },
                        footer: { broad: "合计", share: broadShareSum > 0 ? pctFine(broadShareSum) : "—", option: "—", posterior: null, mass: "—" },
                        emptyText: "等待细化结果",
                        columns: [
                          { key: "broad", label: "大类" },
                          { key: "share", label: "大类质量占比", align: "right", render: function (row) { return pctFine(row.share); } },
                          { key: "option", label: "最可能材质" },
                          { key: "posterior", label: "组内后验", align: "right", render: function (row) { return pct(row.posterior, 1); } },
                          { key: "mass", label: "该材质占全家具", align: "right", render: function (row) { return pctFine(row.mass); } },
                        ],
                      }),
                      h("div", { className: "ffx-note" }, broadShareSum > 0 ? "「大类质量占比」合计 100%；每个大类只列最可能的一种具体材质，因此最后一列合计小于 100%，同大类其余候选见导出报告。" : "缺少重量与体积时无法给出质量占比，上表只列出每个大类最可能的具体材质。"),
                    ),
                    h(
                      Card,
                      { title: "状态与提示" },
                      h(
                        "div",
                        { className: "ffx-kv" },
                        h("b", null, "推断状态"),
                        h("span", null, stageText((status && status.stages && status.stages.composition) || (composition && composition.status) || "—")),
                        h("b", null, "比例口径"),
                        h("span", null, (composition && composition.proportionReportingAllowed ? "可报告" : "区间/条件估计")),
                        h("b", null, "耗时"),
                        h("span", null, payload.elapsedMs ? fmtClock(payload.elapsedMs) : "—"),
                      ),
                      (payload.notices || []).length > 0 ? h("div", { className: "ffx-note", style: { marginTop: 4 } }, "提示：" + payload.notices.join("；")) : null,
                      ((composition && composition.warnings) || []).length > 0
                        ? h("div", { className: "ffx-note", style: { marginTop: 4 } }, "模型提示：" + composition.warnings.slice(0, 3).join("；"))
                        : null,
                    ),
                  ),
                )
              : h(
                  "div",
                  { className: "ffx-flow" },
                  h(
                    "div",
                    { className: "ffx-flowrow mid" },
                    h(Card, { index: 3, title: "家具重量" }, h(Value, { value: "—", unit: "kg" }), h("div", { className: "ffx-note" }, "Fireprediction 预测或手工输入")),
                    h(Card, { index: 4, title: "家具真实体积" }, h(Value, { value: "—", unit: "m³" }), h("div", { className: "ffx-note" }, "包裹体积（含封闭空腔）")),
                    h(
                      Card,
                      { index: 5, title: "密度" },
                      h(
                        "div",
                        { className: "ffx-duo" },
                        h("div", { className: "ffx-duo-cell" }, h("div", { className: "ffx-duo-label" }, "平均密度（含空腔）"), h("div", { className: "ffx-duo-value" }, "—", h("span", { className: "ffx-duo-unit" }, "kg/m³"))),
                        h("div", { className: "ffx-duo-cell" }, h("div", { className: "ffx-duo-label" }, "材料平均密度（除空腔）"), h("div", { className: "ffx-duo-value" }, "—", h("span", { className: "ffx-duo-unit" }, "kg/m³"))),
                      ),
                    ),
                    h(Card, { index: 6, title: "家具材质组合" }, h("div", { className: "ffx-note" }, "由判定模型给出候选构造")),
                  ),
                  h(
                    "div",
                    { className: "ffx-flowrow low" },
                    h(Card, { index: 7, title: "家具中材质的占比" }, h("div", { className: "ffx-note" }, "细化后按密度与质量约束估计")),
                    h(Card, { index: 8, title: "家具的热值" }, h("div", { className: "ffx-note" }, "Σ(mᵢ·Hᵢ) 的加权平均")),
                  ),
                  h(Card, { index: 9, title: "单个家具的火灾荷载", tone: "hero" }, h(Value, { hero: true, value: "—", unit: "MJ" }), h("div", { className: "ffx-note" }, "左侧选择图片与尺寸后点击「开始分析」。")),
                  h("div", { className: "ffx-empty" }, "流程：图片 + 尺寸 → Fireprediction 重量/体积 → 本机材质分割 → 判定模型选构造 → 材质占比 → 火灾荷载"),
                ),
            h(Section, { title: "运行日志", right: ui.events.length > 0 ? h("span", { className: "ffx-chip" }, ui.events.length + " 条") : null }),
            h(LogView, { events: ui.events, autoScroll: true }),
            ui.job && ui.job.error ? h("div", { className: "ffx-error" }, String(ui.job.error)) : null,
          ),
        ),
      );
    }

    function apply(ctx) {
      injectStyle();
      var disposers = [];
      try {
        if (ctx.locale && typeof ctx.locale.register === "function") {
          var disposeLocale = ctx.locale.register(NS, MESSAGES);
          if (typeof disposeLocale === "function") disposers.push(disposeLocale);
        }
      } catch (error) {
        /* locale optional */
      }
      var label = function () {
        try {
          if (ctx.locale && typeof ctx.locale.bind === "function") {
            var bound = ctx.locale.bind(NS);
            if (typeof bound === "function") return bound("entry.label");
          }
        } catch (error) {
          /* ignore */
        }
        return MESSAGES.zh["entry.label"];
      };
      if (ctx.slots && typeof ctx.slots.inject === "function" && typeof ctx.slots.register === "function") {
        disposers.push(
          ctx.slots.inject("sidebar.panellist", function () {
            return ctx.slots.register({ name: "sidebar.panellist", id: PANEL_ID, order: PANEL_ORDER, label: label }, EntryIcon);
          }),
        );
        disposers.push(
          ctx.slots.inject("main", function () {
            return ctx.slots.register({ name: "main", key: PANEL_ID, inject: function () { return {}; } }, Workbench);
          }),
        );
      }
      return function () {
        for (var index = 0; index < disposers.length; index += 1) {
          try {
            disposers[index]();
          } catch (error) {
            /* ignore */
          }
        }
      };
    }

    exports.inject = ["slots", "locale"];
    exports.apply = apply;
    exports.panelId = PANEL_ID;
    exports.EntryIcon = EntryIcon;
    exports.Workbench = Workbench;
    return module.exports;
  },
});
