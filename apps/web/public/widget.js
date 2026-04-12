(function () {
  var script = document.currentScript;
  if (!script) return;

  var tenantId = script.getAttribute("data-tenant-id") || "";
  var widgetToken = script.getAttribute("data-widget-token") || "";
  var primaryColor = script.getAttribute("data-primary-color") || "#F59E0B";
  var apiBase = script.getAttribute("data-api-base") || "";
  var endpoint = (apiBase ? apiBase.replace(/\/$/, "") : "") + "/api/v1/assist/chat";

  if (!tenantId || !widgetToken || !endpoint) return;

  var SESSION_KEY = "qyro_assist_session_id";
  var sessionId = localStorage.getItem(SESSION_KEY) || "";

  var host = document.createElement("div");
  host.id = "qyro-assist-widget-root";
  document.body.appendChild(host);

  var shadow = host.attachShadow({ mode: "open" });

  shadow.innerHTML = ""
    + "<style>"
    + ":host{all:initial}"
    + ".wrap{position:fixed;right:16px;bottom:16px;z-index:2147483000;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif}"
    + ".bubble{width:56px;height:56px;border-radius:999px;border:none;cursor:pointer;background:" + primaryColor + ";color:#111;font-weight:700;box-shadow:0 12px 30px rgba(0,0,0,.22)}"
    + ".panel{display:none;width:320px;max-width:calc(100vw - 24px);height:420px;background:#fff;border:1px solid #e7e7e7;border-radius:16px;box-shadow:0 20px 40px rgba(0,0,0,.2);overflow:hidden}"
    + ".panel.open{display:flex;flex-direction:column}"
    + ".head{padding:12px 14px;border-bottom:1px solid #eee;font-size:14px;font-weight:700;background:#fafafa}"
    + ".messages{flex:1;overflow:auto;padding:12px;background:#fff}"
    + ".msg{margin:0 0 10px;max-width:86%;padding:9px 10px;border-radius:12px;line-height:1.35;font-size:13px;white-space:pre-wrap}"
    + ".msg.user{margin-left:auto;background:#111;color:#fff}"
    + ".msg.bot{margin-right:auto;background:#f4f4f5;color:#111}"
    + ".composer{display:flex;gap:8px;padding:10px;border-top:1px solid #eee;background:#fff}"
    + ".input{flex:1;border:1px solid #ddd;border-radius:10px;padding:9px 10px;font-size:13px;outline:none}"
    + ".send{border:none;border-radius:10px;padding:9px 12px;font-size:13px;font-weight:700;cursor:pointer;background:" + primaryColor + ";color:#111}"
    + ".note{font-size:11px;color:#666;padding:0 12px 10px}"
    + "</style>"
    + "<div class='wrap'>"
    + "  <div id='panel' class='panel'>"
    + "    <div class='head'>Chat with us</div>"
    + "    <div id='messages' class='messages'></div>"
    + "    <div class='composer'>"
    + "      <input id='input' class='input' placeholder='Type your message...' />"
    + "      <button id='send' class='send'>Send</button>"
    + "    </div>"
    + "    <div class='note'>Messages may be reviewed for quality.</div>"
    + "  </div>"
    + "  <button id='bubble' class='bubble' aria-label='Open chat'>Q</button>"
    + "</div>";

  var panel = shadow.getElementById("panel");
  var bubble = shadow.getElementById("bubble");
  var input = shadow.getElementById("input");
  var send = shadow.getElementById("send");
  var messages = shadow.getElementById("messages");

  var history = [];

  function addMessage(role, text) {
    var el = document.createElement("div");
    el.className = "msg " + (role === "user" ? "user" : "bot");
    el.textContent = text;
    messages.appendChild(el);
    messages.scrollTop = messages.scrollHeight;
    history.push({ role: role, content: text });
    if (history.length > 30) history = history.slice(history.length - 30);
  }

  async function postMessage(text) {
    var payload = {
      tenantId: tenantId,
      widgetToken: widgetToken,
      sessionId: sessionId || undefined,
      message: text,
      history: history,
      channel: "chat"
    };

    var res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      credentials: "omit"
    });

    if (!res.ok) {
      throw new Error("Request failed with status " + res.status);
    }

    var body = await res.json();
    var data = body && body.data ? body.data : {};

    if (data.sessionId) {
      sessionId = data.sessionId;
      localStorage.setItem(SESSION_KEY, sessionId);
    }

    return data.reply || "Thanks. A team member will follow up shortly.";
  }

  async function submit() {
    var text = (input.value || "").trim();
    if (!text) return;

    input.value = "";
    addMessage("user", text);

    try {
      var reply = await postMessage(text);
      addMessage("assistant", reply);
    } catch (err) {
      addMessage("assistant", "Sorry, we could not send your message right now.");
    }
  }

  bubble.addEventListener("click", function () {
    panel.classList.toggle("open");
    if (panel.classList.contains("open")) {
      input.focus();
      if (messages.childElementCount === 0) {
        addMessage("assistant", "Hi! How can we help you today?");
      }
    }
  });

  send.addEventListener("click", submit);
  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter") submit();
  });
})();
