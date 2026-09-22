(function(){
  "use strict";

  /* ---------------- storage ---------------- */
  var STORE_KEY = "medibox_state_v2";
  function loadState(){
    try{
      var raw = localStorage.getItem(STORE_KEY);
      if(raw) return JSON.parse(raw);
    }catch(e){}
    return null;
  }
  function saveState(){
    try{ localStorage.setItem(STORE_KEY, JSON.stringify(state)); }catch(e){}
  }

  function pad(n){ return n<10 ? "0"+n : ""+n; }
  function fmtTime(h,m){
    var ap = h>=12 ? "PM":"AM"; var hh = h%12; if(hh===0) hh=12;
    return hh+":"+pad(m)+" "+ap;
  }
  function timeToLabel(t){ var p=t.split(":"); return fmtTime(parseInt(p[0],10), parseInt(p[1],10)); }
  function minutesOf(t){ var p=t.split(":"); return parseInt(p[0],10)*60+parseInt(p[1],10); }

  /* ---------------- default seed ---------------- */
  // Each compartment holds a MEDICINE, not a meal. "mealTag" records which meal
  // that dose is meant to be taken around (many prescriptions say "with breakfast",
  // "after lunch", etc.) — this is what the pattern detector uses.
  function defaultState(){
    return {
      compartments: [
        {id:"metformin", name:"Metformin 500mg", time:"08:00", mealTag:"breakfast"},
        {id:"amlodipine", name:"Amlodipine 5mg", time:"13:00", mealTag:"lunch"},
        {id:"atorvastatin", name:"Atorvastatin 10mg", time:"21:00", mealTag:"dinner"}
      ],
      today: {}, // compartmentId -> {status, at}
      history: [
        {label:"Mon", offset:6, events:{metformin:{status:"verified",at:"08:12"}, amlodipine:{status:"verified",at:"13:04"}, atorvastatin:{status:"verified",at:"21:10"}}},
        {label:"Tue", offset:5, events:{metformin:{status:"verified",at:"08:20"}, amlodipine:{status:"opened_not_taken",at:"13:02"}, atorvastatin:{status:"verified",at:"20:55"}}},
        {label:"Wed", offset:4, events:{metformin:{status:"verified",at:"07:58"}, amlodipine:{status:"verified",at:"13:11"}, atorvastatin:{status:"missed",at:null}}},
        {label:"Thu", offset:3, events:{metformin:{status:"verified",at:"08:25"}, amlodipine:{status:"verified",at:"12:58"}, atorvastatin:{status:"verified",at:"21:03"}}},
        {label:"Fri", offset:2, events:{metformin:{status:"verified",at:"08:10"}, amlodipine:{status:"missed",at:null}, atorvastatin:{status:"verified",at:"21:20"}}},
        {label:"Sat", offset:1, events:{metformin:{status:"verified",at:"09:32"}, amlodipine:{status:"verified",at:"13:40"}, atorvastatin:{status:"verified",at:"20:45"}}}
      ],
      settings: { caregiverAlerts:true, aiRecommendations:true },
      recommendation: { dismissed:false }
    };
  }

  var state = loadState() || defaultState();
  if(!state.recommendation) state.recommendation = {dismissed:false};
  if(!state.settings) state.settings = {caregiverAlerts:true, aiRecommendations:true};
  // migrate old "kind"-based saves (breakfast/lunch/dinner as meals) to the new medicine model
  if(state.compartments && state.compartments[0] && !state.compartments[0].mealTag){
    state = defaultState();
  }

  /* ---------------- icons per meal tag ---------------- */
  var MEAL_ICON = {
    "breakfast": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 18a5 5 0 0 0-10 0"></path><line x1="12" y1="9" x2="12" y2="2"></line><line x1="4.22" y1="10.22" x2="5.64" y2="11.64"></line><line x1="1" y1="18" x2="3" y2="18"></line><line x1="21" y1="18" x2="23" y2="18"></line><line x1="18.36" y1="11.64" x2="19.78" y2="10.22"></line><line x1="23" y1="22" x2="1" y2="22"></line></svg>',
    "lunch": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4.2"></circle><line x1="12" y1="2.5" x2="12" y2="5"></line><line x1="12" y1="19" x2="12" y2="21.5"></line><line x1="4.5" y1="4.5" x2="6.2" y2="6.2"></line><line x1="17.8" y1="17.8" x2="19.5" y2="19.5"></line><line x1="2.5" y1="12" x2="5" y2="12"></line><line x1="19" y1="12" x2="21.5" y2="12"></line><line x1="4.5" y1="19.5" x2="6.2" y2="17.8"></line><line x1="17.8" y1="6.2" x2="19.5" y2="4.5"></line></svg>',
    "dinner": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>',
    "none": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="9.5" width="17" height="8" rx="4" transform="rotate(-45 12 12)"></rect><line x1="8.3" y1="8.3" x2="15.7" y2="15.7"></line></svg>'
  };
  var MEAL_LABEL = { breakfast:"With breakfast", lunch:"With lunch", dinner:"With dinner", none:"No meal link" };

  var STATUS_LABEL = { upcoming:"Upcoming", verified:"Verified", opened_not_taken:"Opened, not taken", missed:"Missed" };

  /* ---------------- todays status derivation ---------------- */
  function getTodayStatus(compId){
    return (state.today[compId] && state.today[compId].status) || "upcoming";
  }

  /* ---------------- render: device twin ---------------- */
  var deviceIdleTimer = null;
  function renderDevice(){
    var now = new Date();
    document.getElementById("devClock").textContent = pad(now.getHours())+":"+pad(now.getMinutes());
    var next = nextUpcoming();
    if(next){
      document.getElementById("devMain").textContent = "Next dose: "+next.name+", "+timeToLabel(next.time);
    } else {
      document.getElementById("devMain").textContent = "All doses handled today";
    }
    var verifiedCount = state.compartments.filter(function(c){ return getTodayStatus(c.id)==="verified"; }).length;
    var missedCount = state.compartments.filter(function(c){ return getTodayStatus(c.id)==="missed" || getTodayStatus(c.id)==="opened_not_taken"; }).length;
    document.getElementById("devSub").textContent = missedCount>0 ? (missedCount+" medicine"+(missedCount>1?"s":"")+" need attention") : (verifiedCount+" of "+state.compartments.length+" verified today");
  }
  function nextUpcoming(){
    var up = state.compartments.filter(function(c){ return getTodayStatus(c.id)==="upcoming"; });
    up.sort(function(a,b){ return minutesOf(a.time)-minutesOf(b.time); });
    return up[0] || null;
  }
  function setDeviceIcons(buzzer,lid,scale){
    document.getElementById("icBuzzer").className = "ic"+(buzzer?" active pulse":"");
    document.getElementById("icLid").className = "ic"+(lid?" active":"");
    document.getElementById("icScale").className = "ic"+(scale?" active":"");
  }

  /* ---------------- render: compartments ---------------- */
  function renderCompartments(){
    var wrap = document.getElementById("compartmentList");
    wrap.innerHTML = "";
    state.compartments.forEach(function(c){
      var status = getTodayStatus(c.id);
      var btn = document.createElement("button");
      btn.className = "capsule";
      btn.innerHTML =
        '<div class="pillshape">'+(MEAL_ICON[c.mealTag]||MEAL_ICON.none)+'</div>'+
        '<div class="info"><div class="name">'+c.name+'</div><div class="time">'+timeToLabel(c.time)+' · <span class="mealchip">'+MEAL_LABEL[c.mealTag]+'</span></div></div>'+
        '<div class="badge '+status+'">'+STATUS_LABEL[status]+'</div>';
      btn.addEventListener("click", function(){ openSimulate(c.id); });
      wrap.appendChild(btn);
    });
  }

  /* ---------------- render: insight card ---------------- */
  // The box doesn't know when a meal is eaten directly — it infers it from when
  // meal-linked MEDICINES actually get verified vs. their scheduled time, then
  // proposes re-timing every medicine tied to that meal (an LLM call in the real
  // system would turn this summarised pattern into the recommendation copy below).
  function computeMealPattern(mealTag){
    var linked = state.compartments.filter(function(c){ return c.mealTag===mealTag; });
    if(!linked.length) return null;
    var offs = [];
    linked.forEach(function(comp){
      state.history.forEach(function(day){
        var ev = day.events[comp.id];
        if(ev && ev.status==="verified" && ev.at){
          offs.push(minutesOf(ev.at) - minutesOf(comp.time));
        }
      });
    });
    if(offs.length < 3) return null;
    var avg = offs.reduce(function(a,b){return a+b;},0) / offs.length;
    if(avg < 8) return null; // not late enough to bother recommending
    var rounded = Math.round(avg/5)*5;
    return { mealTag:mealTag, avgMinutesLate: Math.round(avg), shiftMinutes: rounded, compartments: linked };
  }
  function shiftTime(t, minutes){
    var total = minutesOf(t) + minutes;
    var h = Math.floor(total/60), m = total%60;
    return pad(h)+":"+pad(m);
  }

  function renderInsight(){
    var slot = document.getElementById("insightSlot");
    slot.innerHTML = "";
    if(!state.settings.aiRecommendations || state.recommendation.dismissed) return;

    var mealOrder = ["breakfast","lunch","dinner"];
    var pattern = null;
    for(var i=0;i<mealOrder.length;i++){
      pattern = computeMealPattern(mealOrder[i]);
      if(pattern) break;
    }
    if(!pattern) return;

    var names = pattern.compartments.map(function(c){return c.name;}).join(", ");
    var mealWord = pattern.mealTag;
    var newTimes = pattern.compartments.map(function(c){ return timeToLabel(shiftTime(c.time, pattern.shiftMinutes)); });

    var card = document.createElement("div");
    card.className = "insight";
    card.innerHTML =
      '<div class="insight-top"><div class="ai-dot"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v4"></path><path d="M12 18v4"></path><path d="M4.9 4.9l2.8 2.8"></path><path d="M16.3 16.3l2.8 2.8"></path><path d="M2 12h4"></path><path d="M18 12h4"></path><path d="M4.9 19.1l2.8-2.8"></path><path d="M16.3 7.7l2.8-2.8"></path></svg></div><span>Meal-timing pattern detected</span></div>'+
      '<p>Doses linked to <b>'+mealWord+'</b> ('+names+') are usually verified about <b>'+pattern.avgMinutesLate+' min after</b> their reminder \u2014 your real '+mealWord+' time looks later than the schedule assumes. Shift '+ (pattern.compartments.length>1 ? "these reminders" : "this reminder") +' to <b>'+newTimes.join(", ")+'</b> to match?</p>'+
      '<div class="actions"><button class="primary-btn" id="acceptRec">Shift '+(pattern.compartments.length>1?"reminders":"reminder")+'</button><button class="ghost-btn" id="dismissRec">Not now</button></div>';
    slot.appendChild(card);

    document.getElementById("acceptRec").addEventListener("click", function(){
      pattern.compartments.forEach(function(c){ c.time = shiftTime(c.time, pattern.shiftMinutes); });
      state.recommendation.dismissed = true;
      saveState();
      renderAll();
      showToast((pattern.compartments.length>1?"Reminders":"Reminder")+" shifted to match your "+mealWord+" time");
    });
    document.getElementById("dismissRec").addEventListener("click", function(){
      state.recommendation.dismissed = true;
      saveState();
      renderInsight();
    });
  }

  /* ---------------- render: weekly ring ---------------- */
  function weeklyStats(){
    var total=0, verified=0;
    state.history.forEach(function(day){
      Object.keys(day.events).forEach(function(k){
        total++; if(day.events[k].status==="verified") verified++;
      });
    });
    // include today
    state.compartments.forEach(function(c){
      var st = getTodayStatus(c.id);
      if(st!=="upcoming"){ total++; if(st==="verified") verified++; }
    });
    return { total:total, verified:verified, pct: total? Math.round(verified/total*100):100 };
  }
  function renderRing(){
    var s = weeklyStats();
    document.getElementById("ringPct").textContent = s.pct+"%";
    var circ = 2*Math.PI*15.5;
    var offset = circ - (s.pct/100)*circ;
    var el = document.getElementById("ringProgress");
    el.style.strokeDasharray = circ;
    el.style.strokeDashoffset = offset;
    el.style.transition = "stroke-dashoffset .5s ease";
  }

  /* ---------------- schedule tab ---------------- */
  function renderSchedule(){
    var wrap = document.getElementById("scheduleList");
    wrap.innerHTML = "";
    state.compartments.forEach(function(c){
      var row = document.createElement("div");
      row.className = "row-card";
      row.innerHTML =
        '<div class="pillshape" style="background:var(--surface-2);color:var(--primary);">'+(MEAL_ICON[c.mealTag]||MEAL_ICON.none)+'</div>'+
        '<div style="flex:1;min-width:0;">'+
          '<input type="text" value="'+c.name.replace(/"/g,'&quot;')+'" data-id="'+c.id+'" class="nameInput">'+
          '<select data-id="'+c.id+'" class="mealSelect">'+
            ['breakfast','lunch','dinner','none'].map(function(m){
              return '<option value="'+m+'"'+(c.mealTag===m?' selected':'')+'>'+MEAL_LABEL[m]+'</option>';
            }).join('')+
          '</select>'+
        '</div>'+
        '<input type="time" value="'+c.time+'" data-id="'+c.id+'" class="timeInput">'+
        '<div class="iconbtn delBtn" data-id="'+c.id+'"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path></svg></div>';
      wrap.appendChild(row);
    });
    wrap.querySelectorAll(".nameInput").forEach(function(inp){
      inp.addEventListener("change", function(){
        var c = state.compartments.find(function(x){return x.id===inp.dataset.id;});
        if(c && inp.value.trim()){ c.name = inp.value.trim(); saveState(); renderAll(); showToast("Saved"); }
      });
    });
    wrap.querySelectorAll(".timeInput").forEach(function(inp){
      inp.addEventListener("change", function(){
        var c = state.compartments.find(function(x){return x.id===inp.dataset.id;});
        if(c && inp.value){ c.time = inp.value; saveState(); renderAll(); showToast("Reminder time updated"); }
      });
    });
    wrap.querySelectorAll(".mealSelect").forEach(function(sel){
      sel.addEventListener("change", function(){
        var c = state.compartments.find(function(x){return x.id===sel.dataset.id;});
        if(c){ c.mealTag = sel.value; saveState(); renderAll(); showToast("Meal link updated"); }
      });
    });
    wrap.querySelectorAll(".delBtn").forEach(function(btn){
      btn.addEventListener("click", function(){
        if(state.compartments.length<=1){ showToast("At least one medicine is required"); return; }
        state.compartments = state.compartments.filter(function(x){return x.id!==btn.dataset.id;});
        delete state.today[btn.dataset.id];
        saveState(); renderAll(); showToast("Medicine removed");
      });
    });
  }
  document.getElementById("addCompartment").addEventListener("click", function(){
    var name = prompt("Medicine name (e.g. Vitamin D3 1000IU)");
    if(!name || !name.trim()) return;
    var id = name.trim().toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/(^-|-$)/g,"") + "-" + Math.random().toString(36).slice(2,6);
    state.compartments.push({id:id, name:name.trim(), time:"12:00", mealTag:"none"});
    saveState(); renderAll(); showToast("Medicine added \u2014 set its meal link and time below");
  });

  /* ---------------- history tab ---------------- */
  function dayPct(day){
    var keys = Object.keys(day.events);
    var v = keys.filter(function(k){return day.events[k].status==="verified";}).length;
    return keys.length? Math.round(v/keys.length*100):0;
  }
  function renderSpark(){
    var wrap = document.getElementById("sparkChart");
    wrap.innerHTML = "";
    state.history.forEach(function(day){
      var pct = dayPct(day);
      var cls = pct>=80 ? "bar" : (pct>0 ? "bar low" : "bar zero");
      var h = Math.max(8, pct*0.6);
      var col = document.createElement("div");
      col.className = "bar-wrap";
      col.innerHTML = '<div class="'+cls+'" style="height:'+h+'px;"></div><div class="day-lbl">'+day.label+'</div>';
      wrap.appendChild(col);
    });
    var todayCol = document.createElement("div");
    var tv = state.compartments.filter(function(c){return getTodayStatus(c.id)==="verified";}).length;
    var tdone = state.compartments.filter(function(c){return getTodayStatus(c.id)!=="upcoming";}).length;
    var tpct = tdone? Math.round(tv/tdone*100) : 0;
    var tcls = tpct>=80 ? "bar" : (tpct>0 ? "bar low" : "bar zero");
    todayCol.className = "bar-wrap";
    todayCol.innerHTML = '<div class="'+tcls+'" style="height:'+Math.max(8,tpct*0.6)+'px;"></div><div class="day-lbl">Today</div>';
    wrap.appendChild(todayCol);
  }
  function statusColor(status){
    if(status==="verified") return "var(--accent)";
    if(status==="opened_not_taken") return "var(--warn)";
    if(status==="missed") return "var(--danger)";
    return "var(--line)";
  }
  function renderHistoryList(){
    var wrap = document.getElementById("historyList");
    wrap.innerHTML = "";
    var days = state.history.slice().reverse();
    days.forEach(function(day, idx){
      var card = document.createElement("div");
      card.className = "day-card";
      var dots = Object.keys(day.events).map(function(k){
        return '<div class="d" style="background:'+statusColor(day.events[k].status)+'"></div>';
      }).join("");
      card.innerHTML =
        '<div class="day-head"><div class="date">'+day.label+'</div><div class="pct">'+dayPct(day)+'% verified</div></div>'+
        '<div class="dots">'+dots+'</div>'+
        '<div class="day-detail" id="detail-'+idx+'"></div>';
      var detail = card.querySelector(".day-detail");
      Object.keys(day.events).forEach(function(k){
        var ev = day.events[k];
        var comp = state.compartments.find(function(c){return c.id===k;});
        var name = comp ? comp.name : k;
        var line = document.createElement("div");
        line.className = "detail-line";
        line.innerHTML = "<span>"+name+"</span><b>"+STATUS_LABEL[ev.status]+(ev.at? " · "+timeToLabel(ev.at):"")+"</b>";
        detail.appendChild(line);
      });
      card.querySelector(".day-head").addEventListener("click", function(){
        detail.classList.toggle("open");
      });
      wrap.appendChild(card);
    });
  }

  /* ---------------- settings tab ---------------- */
  function renderSettings(){
    var sw1 = document.getElementById("swCaregiver");
    var sw2 = document.getElementById("swAI");
    sw1.className = "switch"+(state.settings.caregiverAlerts?" on":"");
    sw2.className = "switch"+(state.settings.aiRecommendations?" on":"");
  }
  document.getElementById("swCaregiver").addEventListener("click", function(){
    state.settings.caregiverAlerts = !state.settings.caregiverAlerts;
    saveState(); renderSettings();
    showToast(state.settings.caregiverAlerts ? "Caregiver alerts on" : "Caregiver alerts off");
  });
  document.getElementById("swAI").addEventListener("click", function(){
    state.settings.aiRecommendations = !state.settings.aiRecommendations;
    saveState(); renderSettings(); renderInsight();
    showToast(state.settings.aiRecommendations ? "AI recommendations on" : "AI recommendations off");
  });
  document.getElementById("resetDemo").addEventListener("click", function(){
    if(!confirm("Reset all demo data to the sample dataset?")) return;
    state = defaultState();
    saveState(); renderAll();
    showToast("Demo data reset");
  });

  /* ---------------- toast ---------------- */
  var toastTimer = null;
  function showToast(msg){
    var t = document.getElementById("toast");
    document.getElementById("toastMsg").textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function(){ t.classList.remove("show"); }, 2200);
  }

  /* ---------------- simulate drawer flow ---------------- */
  var overlay = document.getElementById("overlay");
  var drawer = document.getElementById("drawer");
  var drawerBody = document.getElementById("drawerBody");
  var activeCompId = null;

  function closeDrawer(){
    overlay.classList.remove("show");
    drawer.classList.remove("show");
    setDeviceIcons(false,false,false);
    activeCompId = null;
  }
  document.getElementById("drawerClose").addEventListener("click", closeDrawer);
  overlay.addEventListener("click", closeDrawer);

  function openSimulate(compId){
    var status = getTodayStatus(compId);
    var comp = state.compartments.find(function(c){return c.id===compId;});
    if(!comp) return;
    activeCompId = compId;
    if(status !== "upcoming"){
      renderResultView(compId, status);
    } else {
      renderStepAlert(compId);
    }
    overlay.classList.add("show");
    drawer.classList.add("show");
  }

  function renderResultView(compId, status){
    var comp = state.compartments.find(function(c){return c.id===compId;});
    var rec = state.today[compId];
    var label = STATUS_LABEL[status];
    var color = status==="verified" ? "var(--primary)" : (status==="opened_not_taken" ? "var(--warn)" : "var(--danger)");
    drawerBody.innerHTML =
      '<h3>'+comp.name+'</h3>'+
      '<p class="desc">Scheduled for '+timeToLabel(comp.time)+'.</p>'+
      '<div class="step-visual"><div class="ic-lg" style="color:'+color+';background:transparent;">'+iconForStatus(status)+'</div></div>'+
      '<p style="text-align:center;font-weight:800;font-size:15px;margin-bottom:4px;">'+label+(rec&&rec.at?" · "+timeToLabel(rec.at):"")+'</p>'+
      '<p class="desc" style="text-align:center;">'+resultCopy(status)+'</p>'+
      '<button class="drawer-btn outline" id="redoBtn">Re-run simulation</button>';
    document.getElementById("redoBtn").addEventListener("click", function(){
      delete state.today[compId];
      saveState(); renderAll();
      renderStepAlert(compId);
    });
  }
  function iconForStatus(status){
    if(status==="verified") return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
    if(status==="opened_not_taken") return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4"></path><path d="M12 17h.01"></path><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path></svg>';
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>';
  }
  function resultCopy(status){
    if(status==="verified") return "IR sensor detected access and the load cell registered a matching weight drop. Logged as a genuine dose.";
    if(status==="opened_not_taken") return "IR sensor detected access, but the load cell saw no weight change \u2014 flagged instead of falsely marked compliant.";
    return "No lid access was detected before the dose window closed. Caregiver alert queued.";
  }

  function renderStepAlert(compId){
    var comp = state.compartments.find(function(c){return c.id===compId;});
    setDeviceIcons(true,false,false);
    document.getElementById("devMain").textContent = "ALERT: "+comp.name+" due";
    document.getElementById("devSub").textContent = "Buzzer active · waiting for lid";
    drawerBody.innerHTML =
      '<h3>'+comp.name+' reminder</h3>'+
      '<p class="desc">The buzzer sounds and the OLED shows the due medicine at '+timeToLabel(comp.time)+'.</p>'+
      '<div class="step-visual"><div class="ic-lg pulse">'+'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>'+'</div></div>'+
      '<button class="drawer-btn primary" id="step2Btn">Simulate: lid opened</button>'+
      '<button class="drawer-btn bad" id="skipBtn">Simulate: dose window closed (missed)</button>';
    document.getElementById("step2Btn").addEventListener("click", function(){ renderStepWeight(compId); });
    document.getElementById("skipBtn").addEventListener("click", function(){ resolveDose(compId, "missed"); });
  }

  function renderStepWeight(compId){
    var comp = state.compartments.find(function(c){return c.id===compId;});
    setDeviceIcons(true,true,false);
    document.getElementById("devMain").textContent = comp.name+" lid opened";
    document.getElementById("devSub").textContent = "IR sensor triggered · checking weight";
    drawerBody.innerHTML =
      '<h3>Compartment opened</h3>'+
      '<p class="desc">IR sensor confirms access. Now the load cell checks for a weight change.</p>'+
      '<div class="step-visual"><div class="ic-lg">'+'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v2"></path><path d="M5 21h14"></path><path d="M6 21V9l6-4 6 4v12"></path></svg>'+'</div></div>'+
      '<p class="desc" style="text-align:center;font-weight:700;color:var(--ink);">Was a tablet actually removed?</p>'+
      '<div class="result-row">'+
        '<button class="drawer-btn good" id="yesBtn">Yes \u2014 weight dropped</button>'+
        '<button class="drawer-btn warn" id="noBtn">No \u2014 no change</button>'+
      '</div>';
    document.getElementById("yesBtn").addEventListener("click", function(){ resolveDose(compId, "verified"); });
    document.getElementById("noBtn").addEventListener("click", function(){ resolveDose(compId, "opened_not_taken"); });
  }

  function resolveDose(compId, status){
    var now = new Date();
    var at = pad(now.getHours())+":"+pad(now.getMinutes());
    state.today[compId] = { status: status, at: (status==="missed"? null : at) };
    saveState();
    setDeviceIcons(status==="verified", status!=="missed", status==="verified");
    renderAll();
    renderResultView(compId, status);
    if(status==="missed" && state.settings.caregiverAlerts){
      setTimeout(function(){ showToast("Missed-dose alert sent to caregiver"); }, 350);
    } else if(status==="opened_not_taken"){
      setTimeout(function(){ showToast("Flagged: opened but not taken"); }, 350);
    } else if(status==="verified"){
      setTimeout(function(){ showToast("Dose verified and logged"); }, 350);
    }
  }

  /* ---------------- tabs ---------------- */
  var tabs = ["home","schedule","history","settings"];
  document.querySelectorAll(".navbtn").forEach(function(btn){
    btn.addEventListener("click", function(){
      var target = btn.dataset.tab;
      tabs.forEach(function(t){
        document.getElementById("tab-"+t).classList.toggle("active", t===target);
      });
      document.querySelectorAll(".navbtn").forEach(function(b){ b.classList.toggle("active", b===btn); });
    });
  });
  document.getElementById("goHistory").addEventListener("click", function(){
    document.querySelector('.navbtn[data-tab="history"]').click();
  });

  /* ---------------- greeting ---------------- */
  function renderGreeting(){
    var now = new Date();
    var h = now.getHours();
    var g = h<12 ? "Good morning" : (h<17 ? "Good afternoon" : "Good evening");
    document.getElementById("greetTitle").textContent = g+", Aryan";
    var opts = {weekday:"long", month:"long", day:"numeric"};
    document.getElementById("greetDate").textContent = now.toLocaleDateString(undefined, opts);
  }

  /* ---------------- master render ---------------- */
  function renderAll(){
    renderGreeting();
    renderDevice();
    renderCompartments();
    renderInsight();
    renderRing();
    renderSchedule();
    renderSpark();
    renderHistoryList();
    renderSettings();
  }

  renderAll();
  setInterval(renderDevice, 30000);

})();
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/service-worker.js")
    .then(() => console.log("Service Worker Registered"));
}
