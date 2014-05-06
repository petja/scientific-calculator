// The global namespace
if(!scicalc) var scicalc={};

// Used for detecting panel UI related features.
Components.utils.import("resource:///modules/CustomizableUI.jsm");

// User for displaying localizaiton strings
scicalc.str = Components.classes["@mozilla.org/intl/stringbundle;1"]
			.getService(Components.interfaces.nsIStringBundleService)
			.createBundle("chrome://statusscicalc/locale/scicalc.properties")
			.GetStringFromName;

scicalc.invalidExpError = {desc: scicalc.str("expError")};

/**
 * The main namespace is used for all UI related controls
 */
scicalc.main = (function() {
  const WIDGET_ID = "scicalc-container";
  const EVAL_CLASS_REAL = "realMath";
  const EVAL_CLASS_COMPLEX = "complexMath";

  const MODES = {
    1: "complex",
    2: "bin",
    10: "dec",
    16: "hex"
  }

  var evalClass = EVAL_CLASS_REAL;

  // Various popups
  var askPop,infoPop,errorPop;

  // Various parameters related to history
  var historyBox = null;
  var historyLength = 10;
  var historyDoc = null;

  /**
   * shorthand for getting element by id
   */
  var ebd = function(id){
	return document.getElementById(id);
  };

  /**
   * Sets focus to an input box and selects all text
   */
  var setFocus = function(el) {
    el.focus();
    try{
	  el.editor.selectAll();
	} catch(e) { }
  }

  /**
   * Preference manager
   */
  var prefManager;
  var prefObserver = {
    observe: function(subject, topic, prefName) {
	  if (topic != "nsPref:changed") return;

      if (this.handler[prefName]) {
        this.handler[prefName](prefName);
      }
	},

    /**
     * Various prefenrece handlers.
     * k should be same as the haldler name
     */
    handler : {
      useModulo: function(k) {
        scicalc.realMath.useModulo = prefManager.getBoolPref(k);
      },
      history: function(k) {
        historyLength = prefManager.getIntPref(k);
      },
      ignorecomma: function(k) {
        scicalc.realMath.ignoreComma = prefManager.getIntPref(k);
      },
      decimal: function(k) {
        scicalc.realMath.decimalPrecision = prefManager.getIntPref(k);
      }
    }
  }

  // The calculator UI corresponding to the toolbar item.
  var defaultCalculatorUI;
  var activeCalculatorUI;
  var widgetAddObserver = {
    onWidgetAdded: function(widgetId, area, aPosition) {
	  if (widgetId == WIDGET_ID) {
		initiateDefaultUI(true);
	  }
    },
    onPanelUIOpened: function() {
      initiateDefaultUI(true);
    }
  }

  /*
   * Initiates the default calculator UI. Once added, it removes all observers
   * waiting for UI initialization.
   */
  var initiateDefaultUI = function(listenersAlreadyAdded) {
    if (defaultCalculatorUI) {
      // Already initialized.
      return;
    }
    var updateListeners = !listenersAlreadyAdded;
    var panel = ebd(WIDGET_ID);
    if (panel) {
      // UI found. initiate the rest.
      defaultCalculatorUI = new CalculatorUI(panel, ebd("scicalc-input"), ebd("scicalc-icon"));
      
      // We need to update listeners if they are alredy added.
      updateListeners = listenersAlreadyAdded;
    }

    if (updateListeners) {
      if (CustomizableUI) {
        CustomizableUI[panel ? 'removeListener' : 'addListener'](widgetAddObserver);
      }
      var panelUI = ebd("PanelUI-popup")
      if (panelUI) {
        panelUI[panel ? 'removeEventListener' : 'addEventListener']("popupshown", widgetAddObserver.onPanelUIOpened, false);
      }
    }
  }

  /**
   * Addon initialization
   */
  window.addEventListener("load", function() {
    //set preference manaegr
	prefManager = Components.classes["@mozilla.org/preferences-service;1"]
	  .getService(Components.interfaces.nsIPrefBranch)
	  .getBranch("extensions.ststusscicalc.");
    prefManager.QueryInterface(Components.interfaces.nsIPrefBranch2);
	prefManager.addObserver("", prefObserver, false);

    // Initiate various preferences
	for (k in prefObserver.handler) {
      prefObserver.handler[k](k);
    }

    askPop = ebd("scicalc-askmode");
	infoPop = ebd("scicalc-info");
	errorPop = ebd("scicalc-error");

    // Calculation mode
	var mode = prefManager.getIntPref("defaultMode");
	changeModeInternal(MODES[mode] ? MODES[mode] : "ask", mode);

    // Angle: radians or degrees
    scicalc.main.changeAngle(prefManager.getBoolPref("defaultRadian"));

    // Custom user functions
    scicalc.realMath.setUserData();

    // Initiate history
    historyBox = ebd("scicalc-historyBox");

    historyDoc = scicalc.fileIO.getXML("history.xml");
	var hnodes = historyDoc.firstChild.childNodes;
	var n = historyLength;
	if(hnodes.length == 0) n=0;
	if(hnodes.length < n) n = hnodes.length;
	if(n > 0) {
	  var shift = hnodes.length-n;
	  for(var i=0;i<n;i++)
		addHistoryEl(hnodes[i+shift].getAttribute("ques"), hnodes[i+shift].getAttribute("ans"));
	};
	historyBox.setAttribute('rows', n);

    // initiate default UI
    initiateDefaultUI(false);
  }, false);

  /**
   * Addon unload
   */
  window.addEventListener("unload", function() {
    if(prefManager) {
      prefManager.removeObserver("", prefObserver);
    }
    if (CustomizableUI) {
      CustomizableUI.removeListener(widgetAddObserver);
    }
  }, false);

  // ******************* BEGIN_CODE_FOR_HISTORY_MANAGEMENE
  /**
   * Selects the history item on white the moise is current entering.
   */
  var historyElMouseOver = function() {
	historyBox.selectedIndex = historyBox.getIndexOfItem(this);
  }

  /**
   * Adds a history item with
   */
  var addHistoryEl = function(exp,val){
    var a = document.createElement("listitem");
    var b = document.createElement("listcell");
    b.setAttribute("label",exp);
    var c = document.createElement("listcell");
    c.setAttribute("label",val);
    a.appendChild(b);
    a.appendChild(c);
    a.addEventListener("mouseover", historyElMouseOver, false);
    historyBox.appendChild(a);
  };
  // ******************* END_CODE_FOR_HISTORY_MANAGEMENT

  /**
   * Changes the current evaluation mode.
   *
   * @param nid, the id of the corresponding menu item, one of: bin, dec, hex, ask or complex
   * @param mode, the actual base value
   * @param uihandler the correnponding CalculatorUI to operate on or null.
   */
  var changeModeInternal = function(nid, mode, uihandler) {
    if(nid=="ask") ebd("scicalc_mode_ask").label = "Base ("+mode+")...";
    
    if ((mode<1) || (mode>24)) mode = 10;
    ebd("scicalc_mode_" + nid).setAttribute("checked", "true");

    if (uihandler) {
      var updateExp = function(mode, exp) {
  		if (mode == 1)
		  return (evalClass=="complex") ? exp : "";
		if (evalClass == "complex") 
		  return "";

		if (scicalc.realMath.mode == mode) return exp;

		var reg = new RegExp("[\\-\\+]?[" + scicalc.Strings.getRegxSeries(scicalc.realMath.mode) + "\\.]+");
		var m = reg.exec(exp);

		if ((m == null) || (m[0] != exp))
		  return "error";

		var result, pre;
		if ((exp.charAt(0) == "-") || (exp.charAt(0) == "+")){
		  pre = exp.charAt(0);
		  result = scicalc.realMath.converttodec(exp.substr(1));
		} else {
		  pre = "";
		  result = scicalc.realMath.converttodec(exp);
		}
	    return (pre + result.toString(mode).toUpperCase());
	  }

      uihandler.inputbox.value = uihandler.inputbox.value.replace(/^\s\s*/, '').replace(/\s\s*$/, '');
      var ret = updateExp(mode, uihandler.inputbox.value);
	  if (ret == "error")
        uihandler.error();
	  else
		uihandler.inputbox.value = ret;
    }

    if (mode == 1)
      evalClass = EVAL_CLASS_COMPLEX;
	else{
	  evalClass = EVAL_CLASS_REAL;
  	scicalc.realMath.mode = mode;
    }
  }

  /**
   * An abstraction of the calculator UI. This abstraction allows us to potentially have more that one
   * calculatos active in a browser, for example one calculator in the toolsbar and another in
   * the status bar.
   */
  function CalculatorUI(panel, inputbox, icon) {
    this.panel = panel;
    this.inputbox = inputbox;
    this.icon = icon;

    var that = this;

    var showError = function(err){
      ebd("scicalc-errordesc").value = err;
      errorPop.openPopup(icon, "before_start");
    };

    inputbox.addEventListener("keydown", function(e) {
      errorPop.hidePopup();
	  if (!e.which) return;
      
      if(e.which == 13) { //  hit Enter
		var exp = this.value;
		var result;
		  try {
		  	result = scicalc[evalClass].compute(exp);
		  	this.value = result;
		  	setFocus(this);
		  } catch (e) {
		  	that.error();
		  	if(e.desc && typeof(e.desc)=="string") showError(e.desc);
		  	else if (e.name.toLowerCase() == "syntaxerror")
			  showError(scicalc.invalidExpError.desc);
		  }
          e.preventDefault();
		} else if (e.which == 34) { //  hit page down
			that.showAskPopup();
		} else if (e.which==40 || e.which==38) {
			that.showHistoryPopup();
            e.preventDefault();
		}
    }, false);

    icon.addEventListener("click", function() {
      activeCalculatorUI = that;
      ebd('scicalc_mode_popup').showPopup(this,-1,-1,"popup","topleft","bottomleft");
    }, false);
  }

  // Animates the icon to indicate an error.
  CalculatorUI.prototype.error = function() {
    var icon = this.icon;
    icon.setAttribute("error", false);    
	window.setTimeout(function() {
	  icon.setAttribute("error", true);
	}, 50);
  }

  // Shows the history popup attached to this panel
  CalculatorUI.prototype.showHistoryPopup = function() {
    var getStr;
	var clas = scicalc[evalClass];
	if (evalClass == EVAL_CLASS_REAL) {
	  if (clas.mode==10) {
		getStr = function(i) {return i };
	  } else{
		getStr = function(i) {return i.toString(clas.mode).toUpperCase(); };
	  }
	} else {
	  getStr = function(i) {return i.toString(); };
	}

	var vlist = "ans=" + getStr(clas.ans);
	for (var i=0; i < clas.variables.length; i++) {
	  vlist += " ,  ";
	  if(clas.variables[i] != 'ans')
		vlist += clas.variables[i] + "=" + getStr(clas.values[i]);
	}
	var vlistHolder = ebd("scicalc-vlist");
	if (vlist == "")
	  vlistHolder.hidden = true;
	else {
	  vlistHolder.removeAttribute("hidden");
	  vlistHolder.value = vlist;
	}

    // Update the key listener to accept the history entry to the
    // current input box.
    var inputbox = this.inputbox;
    historyBox.onkeydown = function(event){
      if(event.which == 13){ //  hit Enter
        if (historyBox.selectedItem) {
          inputbox.value = historyBox.selectedItem.firstChild.getAttribute('label');
          infoPop.hidePopup();
          setFocus(inputbox);
        }
        return false;
      }
      return true;
    };

	infoPop.openPopup(this.panel,"before_start");
  }

  CalculatorUI.prototype.showAskPopup = function() {
    var modeAsk = ebd("scicalc_mode_ask");
	var textbox = ebd("scicalc-modeaskpopup-value");
	textbox.value = modeAsk.label.substring(modeAsk.label.indexOf("(")+1, modeAsk.label.indexOf(")"));
	askPop.openPopup(this.icon, "before_start");
  }

  /************** Public Methods *****************/
  return {
	setFocusEl : function(id) {
      setFocus(ebd(id));
	},

	onWidgetAdded: function(widgetId, area, aPosition) {
	  if (widgetId == WIDGET_ID) {
		init();
	  }
	},

	openCalc : function() {
	  if (CustomizableUI) {
		var pos = CustomizableUI.getPlacementOfWidget(WIDGET_ID);
		if (pos == null) {
		  // widget not added
		  return;
		} else if (pos.area == "nav-bar") {
          if (defaultCalculatorUI) {
            setFocus(defaultCalculatorUI.inputbox);
          }
		} else {
		  // Panel UI
          var panelUI = ebd("PanelUI-popup")
          if (panelUI && PanelUI) {
            var showHandler = function() {
              if (defaultCalculatorUI) {
                setFocus(defaultCalculatorUI.inputbox);
              }
              panelUI.removeEventListener("popupshown", showHandler, false);
            };
            panelUI.addEventListener("popupshown", showHandler, false);
            PanelUI.show();
          }
		}
	  } else if (defaultCalculatorUI) {
        setFocus(defaultCalculatorUI.inputbox);
	  }
	},

	changeAngle : function(isRadian) {
	  if (isRadian){
		scicalc.realMath.trigoBase = "Math";
		ebd("scicalc_angle_rad").setAttribute("checked", "true");
	  } else {
		scicalc.realMath.trigoBase = "scicalc.realMath";
		ebd("scicalc_angle_deg").setAttribute("checked", "true");
	  }
	},

	openOptions : function() {
		window.openDialog("chrome://statusscicalc/content/options.xul","omanager",
						  "chrome, modal=yes, toolbar");
		scicalc.realMath.setUserData();
	},

	hideAskPopup :function() {
	  askPop.hidePopup();
	},

	acceptAskPopup : function() {
	  var val = ebd("scicalc-modeaskpopup-value").value.toLowerCase();
	  var ret = -1;
	  if (val == "b")	ret = 2;
	  else if (val == "d") ret = 10;
	  else if (val == "h") ret = 16;
	  else{
		var x = Math.floor(parseInt(val));
		if(x.toString() == val)
		if((x>=2) && (x<=24)) ret = x;
	  }
	  if(ret == -1) return;
	  changeModeInternal('ask',ret, activeCalculatorUI);
      if (activeCalculatorUI) {
        setFocus(activeCalculatorUI.inputbox);
      }
	  this.hideAskPopup();
	},

	addHistory : function(ques, ans) {
	  addHistoryEl(ques,ans);
	  var popChildren = historyBox.childNodes;
	  while (popChildren.length>(historyLength+1))
		historyBox.removeChild(popChildren[1]);

	  historyBox.setAttribute('rows', popChildren.length-1);
  
	  var entry = historyDoc.createElement("calc");
	  entry.setAttribute("ques", ques);
	  entry.setAttribute("ans", ans);
	  
	  var docf =historyDoc.firstChild;
	  docf.appendChild(entry);

	  while(docf.childNodes.length>2*historyLength)
		docf.removeChild(docf.childNodes[0]);
	  scicalc.fileIO.saveXML(historyDoc,"history.xml");
	},

    /**
     * Changes the mode to the specifid base if it is one of 1 (complex), 2, 10, 16. Ohterwise shows
     * the ask popup.
     */
    changeMode : function(base) {
      if (MODES[base]) {
        changeModeInternal(MODES[base], base, activeCalculatorUI);
      } else if (activeCalculatorUI) {
        activeCalculatorUI.showAskPopup();
      }
    }
}
})();