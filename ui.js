/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// **********
// Title: boxes.js

// ##########
// Class: UI
// Singleton top-level UI manager.

/*

Options
* containerSelector
* defaultBoxSize {

*/

var UI = {

  // Variable: _containerSelector
  // Selector for grid container
  _containerSelector: null,

  // Variable: _frameInitialized
  // True if the UI frame has been initialized.
  _frameInitialized: false,

  // Variable: _pageBounds
  // Stores the page bounds.
  _pageBounds: null,

  // Constant: _maxInteractiveWait
  // If the UI is in the middle of an operation, this is the max amount of
  // milliseconds to wait between input events before we no longer consider
  // the operation interactive.
  _maxInteractiveWait: 250,

  // Variable: _storageBusy
  // Tells whether the storage is currently busy or not.
  _storageBusy: false,

  // ----------
  // Function: toString
  // Prints [UI] for debug use
  toString: function UI_toString() {
    return "[UI]";
  },

  // ----------
  // Function: init
  // Must be called after the object is created.
  init: function UI_init(containerSelector) {
    try {
      let self = this;

      self._containerSelector = containerSelector;

      /*
      // ___ storage
      Storage.init();

      let data = Storage.readUIData(gWindow);
      this._storageSanity(data);
      this._pageBounds = data.pageBounds;
      */

      // When you click on the background/empty part of page,
      // we create a new item.
      iQ(document).mousedown(function(e) {
        if (iQ(":focus").length > 0) {
          iQ(":focus").each(function(element) {
            // don't fire blur event if the same input element is clicked.
            if (e.target != element && element.nodeName == "INPUT")
              element.blur();
          });
        }
        if (self._nodeIsContainer(e.originalTarget) &&
            Utils.isLeftClick(e) &&
            e.detail == 1) {
          self._createItemOnDrag(e);
        }
      });

      // Create a item in edit mode on double click
      iQ(document).dblclick(function(e) {
        if (!self._nodeIsContainer(e.originalTarget)) {
          return
        }

        // Create a item on double click
        let box =
          new Rect(e.clientX - Math.floor(160/2),
                   e.clientY - Math.floor(120/2),
                   160, 120);
        box.inset(-30, -30);

        var opts = {immediately: true, bounds: box};
        var item = new Item([], opts);
      });

      iQ(window).bind("unload", function() {
        self.uninit();
      });

      // ___ Items
      Items.init();
      Items.pauseArrange();
      let hasItemsData = Items.load();

      if (!hasItemsData)
        this.reset();

      // ___ resizing
      if (this._pageBounds)
        this._resize(true);
      else
        this._pageBounds = Items.getPageBounds();

      iQ(window).resize(function() {
        self._resize();
      });

      // ___ Done
      this._frameInitialized = true;
      this._save();

    } catch(e) {
      Utils.log(e);
    } finally {
      Items.resumeArrange();
    }
  },

  // Function: uninit
  // Should be called when window is unloaded.
  uninit: function UI_uninit() {
    // additional clean up
    Items.uninit();
    //Storage.uninit();

    this._pageBounds = null;
    this._frameInitialized = false;
  },

  // Function: reset
  // Resets the view to have just one item
  reset: function UI_reset() {

    // ___ remove existing items
    Items.items.forEach(function(item) {
      item.close()
    })
    
    // ___ create new item
    var box = new Rect(100, 100, 200, 150);
    let options = {
      bounds: box,
      immediately: true
    }

    var item = new Item([], options)
    this.setActive(item)
  },

  // ----------
  // Function: blurAll
  // Blurs any currently focused element
  blurAll: function UI_blurAll() {
    iQ(":focus").each(function(element) {
      element.blur();
    });
  },

  // ----------
  // Function: isIdle
  // Returns true if the last interaction was long enough ago to consider the
  // UI idle. Used to determine whether interactivity would be sacrificed if 
  // the CPU was to become busy.
  //
  isIdle: function UI_isIdle() {
    let time = Date.now();
    let maxEvent = Math.max(drag.lastMoveTime, resize.lastMoveTime);
    return (time - maxEvent) > this._maxInteractiveWait;
  },

  // ----------
  // Function: setActive
  // Sets the active item
  // Parameters:
  //
  // options
  setActive: function UI_setActive(item, options) {
    Utils.assert(item, "item must be given");
    Items.setActiveItem(item);
  },

  // ----------
  // Function: storageBusy
  // Pauses the storage activity that conflicts with sessionstore updates and 
  // private browsing mode switches. Calls can be nested. 
  storageBusy: function UI_storageBusy() {
    if (this._storageBusy)
      return;

    this._storageBusy = true;

    Items.pauseAutoclose();
  },
  
  // ----------
  // Function: storageReady
  // Resumes the activity paused by storageBusy, and updates for any new item
  // information in sessionstore. Calls can be nested. 
  storageReady: function UI_storageReady() {
    if (!this._storageBusy)
      return;

    this._storageBusy = false;

    let hasItemsData = Items.load();
    if (!hasItemsData)
      this.reset();

    Items.resumeAutoclose();
  },

  // ----------
  // Function: _createItemOnDrag
  // Called in response to a mousedown in empty space in the main UI;
  // creates a new item based on the user's drag.
  _createItemOnDrag: function UI__createItemOnDrag(e) {
    const minSize = 60;
    const minMinSize = 15;

    var lastActiveItem = Items.getActiveItem();

    var startPos = { x: e.clientX, y: e.clientY };
    var phantom = iQ("<div>")
      .addClass("item phantom activeItem dragRegion")
      .css({
        position: "absolute",
        zIndex: -1,
        cursor: "default"
      })
      .appendTo("body");

    var item = { // a faux-Item
      container: phantom,
      isAFauxItem: true,
      bounds: {},
      getBounds: function FauxItem_getBounds() {
        return this.container.bounds();
      },
      setBounds: function FauxItem_setBounds(bounds) {
        this.container.css(bounds);
      },
      setZ: function FauxItem_setZ(z) {
        // don't set a z-index because we want to force it to be low.
      },
      setOpacity: function FauxItem_setOpacity(opacity) {
        this.container.css("opacity", opacity);
      },
      // we don't need to pushAway the phantom item at the end, because
      // when we create a new Item, it'll do the actual pushAway.
      pushAway: function () {},
    }

    item.setBounds(new Rect(startPos.y, startPos.x, 0, 0));

    var dragOutInfo = new Drag(item, e);

    function updateSize(e) {
      var box = new Rect();
      box.left = Math.min(startPos.x, e.clientX);
      box.right = Math.max(startPos.x, e.clientX);
      box.top = Math.min(startPos.y, e.clientY);
      box.bottom = Math.max(startPos.y, e.clientY);
      item.setBounds(box);

      // compute the stationaryCorner
      var stationaryCorner = "";

      if (startPos.y == box.top)
        stationaryCorner += "top";
      else
        stationaryCorner += "bottom";

      if (startPos.x == box.left)
        stationaryCorner += "left";
      else
        stationaryCorner += "right";

      dragOutInfo.snap(stationaryCorner, false, false); // null for ui, which we don't use anyway.

      box = item.getBounds();
      if (box.width > minMinSize && box.height > minMinSize &&
         (box.width > minSize || box.height > minSize))
        item.setOpacity(1);
      else
        item.setOpacity(0.7);

      e.preventDefault();
    }

    let self = this;
    function collapse() {
      var center = phantom.bounds().center();
      phantom.animate({
        width: 0,
        height: 0,
        top: center.y,
        left: center.x
      }, {
        duration: 300,
        complete: function() {
          phantom.remove();
        }
      });
      if (lastActiveItem)
        self.setActive(lastActiveItem);
    }

    function finalize(e) {
      iQ(window).unbind("mousemove", updateSize);
      item.container.removeClass("dragRegion");
      dragOutInfo.stop();
      var box = item.getBounds();
      if (box.width > minMinSize && box.height > minMinSize &&
         (box.width > minSize || box.height > minSize)) {
        var opts = {bounds: item.getBounds(), focusTitle: true};
        item = new Item([], opts);
        self.setActive(item);
        phantom.remove();
        dragOutInfo = null;
      } else {
        collapse();
      }
    }

    iQ(window).mousemove(updateSize)
    iQ(window).one("mouseup", finalize);
    e.preventDefault();
    return false;
  },

  // ----------
  // Function: _resize
  // Update the TabView UI contents in response to a window size change.
  // Won't do anything if it doesn't deem the resize necessary.
  // Parameters:
  //   force - true to update even when "unnecessary"; default false
  _resize: function UI__resize(force) {
    if (!this._pageBounds)
      return;

    // Here are reasons why we *won't* resize:
    // 1. Panorama isn't visible (in which case we will resize when we do display)
    // 2. the screen dimensions haven't changed
    // 3. everything on the screen fits and nothing feels cramped
    if (!force)
      return;

    let oldPageBounds = new Rect(this._pageBounds);
    let newPageBounds = Items.getPageBounds();
    if (newPageBounds.equals(oldPageBounds))
      return;

    if (!this.shouldResizeItems())
      return;

    var items = Items.getTopLevelItems();

    // compute itemBounds: the union of all the top-level items' bounds.
    var itemBounds = new Rect(this._pageBounds);
    // We start with pageBounds so that we respect the empty space the user
    // has left on the page.
    itemBounds.width = 1;
    itemBounds.height = 1;
    items.forEach(function(item) {
      var bounds = item.getBounds();
      itemBounds = (itemBounds ? itemBounds.union(bounds) : new Rect(bounds));
    });

    if (newPageBounds.width < this._pageBounds.width &&
        newPageBounds.width > itemBounds.width)
      newPageBounds.width = this._pageBounds.width;

    if (newPageBounds.height < this._pageBounds.height &&
        newPageBounds.height > itemBounds.height)
      newPageBounds.height = this._pageBounds.height;

    var wScale;
    var hScale;
    if (Math.abs(newPageBounds.width - this._pageBounds.width)
         > Math.abs(newPageBounds.height - this._pageBounds.height)) {
      wScale = newPageBounds.width / this._pageBounds.width;
      hScale = newPageBounds.height / itemBounds.height;
    } else {
      wScale = newPageBounds.width / itemBounds.width;
      hScale = newPageBounds.height / this._pageBounds.height;
    }

    var scale = Math.min(hScale, wScale);
    var self = this;
    var pairs = [];
    items.forEach(function(item) {
      var bounds = item.getBounds();
      bounds.left += newPageBounds.left - self._pageBounds.left;
      bounds.left *= scale;
      bounds.width *= scale;

      bounds.top += newPageBounds.top - self._pageBounds.top;
      bounds.top *= scale;
      bounds.height *= scale;

      pairs.push({
        item: item,
        bounds: bounds
      });
    });

    Items.unsquish(pairs);

    pairs.forEach(function(pair) {
      pair.item.setBounds(pair.bounds, true);
      pair.item.snap();
    });

    this._pageBounds = Items.getPageBounds();
    this._save();
  },
  
  // ----------
  // Function: shouldResizeItems
  // Returns whether we should resize the items on the screen, based on whether
  // the top-level items fit in the screen or not and whether they feel
  // "cramped" or not.
  // These computations may be done using cached values. The cache can be
  // cleared with UI.clearShouldResizeItems().
  shouldResizeItems: function UI_shouldResizeItems() {
    let newPageBounds = Items.getPageBounds();
    
    // If we don't have cached cached values...
    if (this._minimalRect === undefined || this._feelsCramped === undefined) {

      // Loop through every top-level Item for two operations:
      // 1. check if it is feeling "cramped" due to squishing (a technical term),
      // 2. union its bounds with the minimalRect
      let feelsCramped = false;
      let minimalRect = new Rect(0, 0, 1, 1);
      
      Items.getTopLevelItems()
        .forEach(function UI_shouldResizeItems_checkItem(item) {
          let bounds = new Rect(item.getBounds());
          feelsCramped = feelsCramped || (item.userSize &&
            (item.userSize.x > bounds.width || item.userSize.y > bounds.height));
          bounds.inset(-Trenches.defaultRadius, -Trenches.defaultRadius);
          minimalRect = minimalRect.union(bounds);
        });
      
      // ensure the minimalRect extends to, but not beyond, the origin
      minimalRect.left = 0;
      minimalRect.top  = 0;
  
      this._minimalRect = minimalRect;
      this._feelsCramped = feelsCramped;
    }

    return this._minimalRect.width > newPageBounds.width ||
      this._minimalRect.height > newPageBounds.height ||
      this._feelsCramped;
  },
  
  // ----------
  // Function: clearShouldResizeItems
  // Clear the cache of whether we should resize the items on the Panorama
  // screen, forcing a recomputation on the next UI.shouldResizeItems()
  // call.
  clearShouldResizeItems: function UI_clearShouldResizeItems() {
    delete this._minimalRect;
    delete this._feelsCramped;
  },

  // ----------
  // Function: storageSanity
  // Given storage data for this object, returns true if it looks valid.
  _storageSanity: function UI__storageSanity(data) {
    if (Utils.isEmptyObject(data))
      return true;

    if (!Utils.isRect(data.pageBounds)) {
      Utils.log("UI.storageSanity: bad pageBounds", data.pageBounds);
      data.pageBounds = null;
      return false;
    }

    return true;
  },

  // ----------
  // Function: _save
  // Saves the data for this object to persistent storage
  _save: function UI__save() {
    if (!this._frameInitialized)
      return;

    /*
    var data = {
      pageBounds: this._pageBounds
    };

    if (this._storageSanity(data))
      Storage.saveUIData(gWindow, data);
    */
  },

  // ----------
  // Function: _saveAll
  // Saves all data associated with TabView.
  _saveAll: function UI__saveAll() {
    this._save();
    Items.saveAll();
  },

  _nodeIsContainer: function _nodeIsContainer(node) {
    return node == document.querySelector(this._containerSelector)
  }
};
