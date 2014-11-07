/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// **********
// Title: items.js

// ##########
// Class: Item
// Superclass for all visible objects
//
// A single item in the window.
//
// Note that it implements the <Subscribable> interface.
// Subclasses of Item must also provide the <Subscribable> interface.
//
// If you subclass, in addition to the things Item provides, you need to also provide these methods:
//   setBounds - function(rect, immediately, options)
//   setZ - function(value)
//   close - function()
//   save - function()
//
// ----------
// Constructor: Item
//
// Parameters:
//   listOfEls - an array of DOM elements for tabs to be added to this item
//   options - various options for this item (see below). In addition, gets passed
//     to <add> along with the elements provided.
//
// Possible options:
//   id - specifies the item's id; otherwise automatically generated
//   userSize - see <Item.userSize>; default is null
//   bounds - a <Rect>; otherwise based on the locations of the provided elements
//   container - a DOM element to use as the container for this item; otherwise will create
//   title - the title for the item; otherwise blank
//   focusTitle - focus the title's input field after creation
//   dontPush - true if this item shouldn't push away or snap on creation; default is false
//   immediately - true if we want all placement immediately, not with animation
function Item(listOfEls, options) {
  // Variable: bounds
  // The position and size of this Item, represented as a <Rect>.
  // This should never be modified without using setBounds()
  this.bounds = null;

  // Variable: zIndex
  // The z-index for this item.
  this.zIndex = 0;

  // Variable: container
  // The outermost DOM element that describes this item on screen.
  this.container = null;

  // Variable: userSize
  // A <Point> that describes the last size specifically chosen by the user.
  // Used by unsquish.
  this.userSize = null;

  // Variable: dragOptions
  // Used by <draggable>
  //
  // Possible properties:
  //   cancelClass - A space-delimited list of classes that should cancel a drag
  //   start - A function to be called when a drag starts
  //   drag - A function to be called each time the mouse moves during drag
  //   stop - A function to be called when the drag is done
  this.dragOptions = null;

  // Variable: dropOptions
  // Used by <draggable> if the item is set to droppable.
  //
  // Possible properties:
  //   accept - A function to determine if a particular item should be accepted for dropping
  //   over - A function to be called when an item is over this item
  //   out - A function to be called when an item leaves this item
  //   drop - A function to be called when an item is dropped in this item
  this.dropOptions = null;

  // Variable: resizeOptions
  // Used by <resizable>
  //
  // Possible properties:
  //   minWidth - Minimum width allowable during resize
  //   minHeight - Minimum height allowable during resize
  //   aspectRatio - true if we should respect aspect ratio; default false
  //   start - A function to be called when resizing starts
  //   resize - A function to be called each time the mouse moves during resize
  //   stop - A function to be called when the resize is done
  this.resizeOptions = null;

  // Variable: isDragging
  // Boolean for whether the item is currently being dragged or not.
  this.isDragging = false;

  if (!options)
    options = {}

  this._inited = false
  this._uninited = false
  this._content = options.content || ''
  this.id = options.id || null
  this.isAItem = true

  this.keepProportional = false
  this._frozenItemSizeData = {}

  if (Utils.isPoint(options.userSize))
    this.userSize = new Point(options.userSize);

  var self = this;

  var rectToBe;
  if (options.bounds) {
    Utils.assert(Utils.isRect(options.bounds), "options.bounds must be a Rect");
    rectToBe = new Rect(options.bounds);
  }

  if (!rectToBe) {
    rectToBe = Items.getBoundingBox(listOfEls);
    rectToBe.inset(-42, -42);
  }

  var $container = options.container;
  let immediately = options.immediately || $container ? true : false;
  if (!$container) {
    $container = iQ('<div>')
      .addClass('item')
      .css({position: 'absolute'})
      .css(rectToBe);
  }

  this.bounds = $container.bounds();

  this.isDragging = false;

  $container
    .css({zIndex: -100})
    .attr("data-id", this.id)
    .appendTo("body");

  // ___ Resizer
  this.$resizer = iQ("<div>")
    .addClass('resizer')
    .appendTo($container)
    .hide();

  // ___ Titlebar
  var html =
    "<div class='title-container'>" +
      "<input class='name' />" +
      "<div class='title-shield' />" +
    "</div>";

  this.$titlebar = iQ('<div>')
    .addClass('titlebar')
    .html(html)
    .appendTo($container);

  this.$closeButton = iQ('<div>')
    .addClass('close')
    .click(function() {
      self.close();
    })
    .attr("title", 'Close')
    .appendTo($container);

  // ___ Content
  this.$content = iQ('<div>')
    .addClass('content')
    .appendTo($container)

  // ___ Title
  this.$titleContainer = iQ('.title-container', this.$titlebar);
  this.$title = iQ('.name', this.$titlebar).attr('placeholder', this.defaultName);
  this.$titleShield = iQ('.title-shield', this.$titlebar);
  this.setTitle(options.title);

  var handleKeyPress = function (e) {
    if (e.keyCode == KeyEvent.DOM_VK_ESCAPE ||
        e.keyCode == KeyEvent.DOM_VK_RETURN ||
        e.keyCode == KeyEvent.DOM_VK_ENTER) {
      (self.$title)[0].blur();
      self.$title
        .addClass("transparentBorder")
        .one("mouseout", function() {
          self.$title.removeClass("transparentBorder");
        });
      e.stopPropagation();
      e.preventDefault();
    }
  }

  var handleKeyUp = function(e) {
    // NOTE: When user commits or cancels IME composition, the last key
    //       event fires only a keyup event.  Then, we shouldn't take any
    //       reactions but we should update our status.
    self.save();
  }

  this.$title
    .blur(function() {
      self._titleFocused = false;
      self.$title[0].setSelectionRange(0, 0);
      self.$titleShield.show();
      self.save();
    })
    .focus(function() {
      self._unfreezeItemSize();
      if (!self._titleFocused) {
        (self.$title)[0].select();
        self._titleFocused = true;
      }
    })
    .mousedown(function(e) {
      e.stopPropagation();
    })
    .keypress(handleKeyPress)
    .keyup(handleKeyUp)
    .attr("title", 'Name this item')

  this.$titleShield
    .mousedown(function(e) {
      self.lastMouseDownTarget = (Utils.isLeftClick(e) ? e.target : null);
    })
    .mouseup(function(e) {
      var same = (e.target == self.lastMouseDownTarget);
      self.lastMouseDownTarget = null;
      if (!same)
        return;

      if (!self.isDragging)
        self.focusTitle();
    })
    .attr("title", 'Name this item')

  if (options.focusTitle)
    this.focusTitle();

  this.$content
    .dblclick(function() {
      self.enterEditMode()
    })
    /*
    .click(function() {
      self.onContentClick()
    })
    */

  // ___ Superclass initialization
  this._init($container[0]);

  // ___ Finish Up
  this._addHandlers($container);

  this.setResizable(true, immediately);

  Items.register(this);

  // ___ Position
  this.setBounds(rectToBe, immediately);
  if (options.dontPush) {
    this.setZ(drag.zIndex);
    drag.zIndex++; 
  } else {
    // Calling snap will also trigger pushAway
    this.snap(immediately);
  }

  if (!options.immediately && listOfEls.length > 0)
    $container.hide().fadeIn();

  this._inited = true;
  this.save();

  Items.updateCloseButtons();
}

Item.prototype = Utils.extend(new Subscribable(), {
  // ----------
  // Function: _init
  // Initializes the object. To be called from the subclass's intialization function.
  //
  // Parameters:
  //   container - the outermost DOM element that describes this item onscreen.
  _init: function Item__init(container) {
    Utils.assert(typeof this.addSubscriber == 'function' && 
        typeof this.removeSubscriber == 'function' && 
        typeof this._sendToSubscribers == 'function',
        'Subclass must implement the Subscribable interface');
    Utils.assert(Utils.isDOMElement(container), 'container must be a DOM element');
    Utils.assert(typeof this.setBounds == 'function', 'Subclass must provide setBounds');
    Utils.assert(typeof this.setZ == 'function', 'Subclass must provide setZ');
    Utils.assert(typeof this.close == 'function', 'Subclass must provide close');
    Utils.assert(typeof this.save == 'function', 'Subclass must provide save');
    Utils.assert(Utils.isRect(this.bounds), 'Subclass must provide bounds');

    this.container = container;
    this.$container = iQ(container);

    iQ(this.container).data('item', this);

    // ___ drag
    this.dragOptions = {
      cancelClass: 'close stackExpander',
      start: function(e, ui) {
        UI.setActive(this);
        this._unfreezeItemSize();
        drag.info = new Drag(this, e);
      },
      drag: function(e) {
        drag.info.drag(e);
      },
      stop: function() {
        drag.info.stop();
        drag.info = null;
      },
      // The minimum the mouse must move after mouseDown in order to move an 
      // item
      minDragDistance: 3
    };

    // ___ drop
    this.dropOptions = {
      over: function() {},
      out: function() {
        iQ(this.container).removeClass("acceptsDrop");
      },
      drop: function(event) {
        iQ(this.container).removeClass("acceptsDrop");
      },
      // Function: dropAcceptFunction
      // Given a DOM element, returns true if it should accept tabs being dropped on it.
      accept: function dropAcceptFunction(item) {
        return false
      }
    };

    // ___ resize
    var self = this;
    this.resizeOptions = {
      aspectRatio: self.keepProportional,
      minWidth: 90,
      minHeight: 90,
      start: function(e,ui) {
        UI.setActive(this);
        resize.info = new Drag(this, e);
      },
      resize: function(e,ui) {
        resize.info.snap(UI.rtl ? 'topright' : 'topleft', false, self.keepProportional);
      },
      stop: function() {
        self.setUserSize();
        self.pushAway();
        resize.info.stop();
        resize.info = null;
      }
    };
  },

  // ----------
  // Function: getBounds
  // Returns a copy of the Item's bounds as a <Rect>.
  getBounds: function Item_getBounds() {
    Utils.assert(Utils.isRect(this.bounds), 'this.bounds should be a rect');
    return new Rect(this.bounds);
  },

  // ----------
  // Function: overlapsWithOtherItems
  // Returns true if this Item overlaps with any other Item on the screen.
  overlapsWithOtherItems: function Item_overlapsWithOtherItems() {
    var self = this;
    var items = Items.getTopLevelItems();
    var bounds = this.getBounds();
    return items.some(function(item) {
      if (item == self) // can't overlap with yourself.
        return false;
      var myBounds = item.getBounds();
      return myBounds.intersects(bounds);
    } );
  },

  // ----------
  // Function: setPosition
  // Moves the Item to the specified location.
  //
  // Parameters:
  //   left - the new left coordinate relative to the window
  //   top - the new top coordinate relative to the window
  //   immediately - if false or omitted, animates to the new position;
  //   otherwise goes there immediately
  setPosition: function Item_setPosition(left, top, immediately) {
    Utils.assert(Utils.isRect(this.bounds), 'this.bounds');
    this.setBounds(new Rect(left, top, this.bounds.width, this.bounds.height), immediately);
  },

  // ----------
  // Function: setSize
  // Resizes the Item to the specified size.
  //
  // Parameters:
  //   width - the new width in pixels
  //   height - the new height in pixels
  //   immediately - if false or omitted, animates to the new size;
  //   otherwise resizes immediately
  setSize: function Item_setSize(width, height, immediately) {
    Utils.assert(Utils.isRect(this.bounds), 'this.bounds');
    this.setBounds(new Rect(this.bounds.left, this.bounds.top, width, height), immediately);
  },

  // ----------
  // Function: setUserSize
  // Remembers the current size as one the user has chosen.
  setUserSize: function Item_setUserSize() {
    Utils.assert(Utils.isRect(this.bounds), 'this.bounds');
    this.userSize = new Point(this.bounds.width, this.bounds.height);
    this.save();
  },

  // ----------
  // Function: getZ
  // Returns the zIndex of the Item.
  getZ: function Item_getZ() {
    return this.zIndex;
  },

  // ----------
  // Function: setRotation
  // Rotates the object to the given number of degrees.
  setRotation: function Item_setRotation(degrees) {
    var value = degrees ? "rotate(%deg)".replace(/%/, degrees) : null;
    iQ(this.container).css({"transform": value});
  },

  // ----------
  // Function: pushAway
  // Pushes all other items away so none overlap this Item.
  //
  // Parameters:
  //  immediately - boolean for doing the pushAway without animation
  pushAway: function Item_pushAway(immediately) {
    var items = Items.getTopLevelItems();

    // we need at least two top-level items to push something away
    if (items.length < 2)
      return;

    var buffer = Math.floor(Items.defaultGutter / 2);

    // setup each Item's pushAwayData attribute:
    items.forEach(function pushAway_setupPushAwayData(item) {
      var data = {};
      data.bounds = item.getBounds();
      data.startBounds = new Rect(data.bounds);
      // Infinity = (as yet) unaffected
      data.generation = Infinity;
      item.pushAwayData = data;
    });

    // The first item is a 0-generation pushed item. It all starts here.
    var itemsToPush = [this];
    this.pushAwayData.generation = 0;

    var pushOne = function Item_pushAway_pushOne(baseItem) {
      // the baseItem is an n-generation pushed item. (n could be 0)
      var baseData = baseItem.pushAwayData;
      var bb = new Rect(baseData.bounds);

      // make the bounds larger, adding a +buffer margin to each side.
      bb.inset(-buffer, -buffer);
      // bbc = center of the base's bounds
      var bbc = bb.center();

      items.forEach(function Item_pushAway_pushOne_pushEach(item) {
        if (item == baseItem)
          return;

        var data = item.pushAwayData;
        // if the item under consideration has already been pushed, or has a lower
        // "generation" (and thus an implictly greater placement priority) then don't move it.
        if (data.generation <= baseData.generation)
          return;

        // box = this item's current bounds, with a +buffer margin.
        var bounds = data.bounds;
        var box = new Rect(bounds);
        box.inset(-buffer, -buffer);

        // if the item under consideration overlaps with the base item...
        if (box.intersects(bb)) {

          // Let's push it a little.

          // First, decide in which direction and how far to push. This is the offset.
          var offset = new Point();
          // center = the current item's center.
          var center = box.center();

          // Consider the relationship between the current item (box) + the base item.
          // If it's more vertically stacked than "side by side"...
          if (Math.abs(center.x - bbc.x) < Math.abs(center.y - bbc.y)) {
            // push vertically.
            if (center.y > bbc.y)
              offset.y = bb.bottom - box.top;
            else
              offset.y = bb.top - box.bottom;
          } else { // if they're more "side by side" than stacked vertically...
            // push horizontally.
            if (center.x > bbc.x)
              offset.x = bb.right - box.left;
            else
              offset.x = bb.left - box.right;
          }

          // Actually push the Item.
          bounds.offset(offset);

          // This item now becomes an (n+1)-generation pushed item.
          data.generation = baseData.generation + 1;
          // keep track of who pushed this item.
          data.pusher = baseItem;
          // add this item to the queue, so that it, in turn, can push some other things.
          itemsToPush.push(item);
        }
      });
    };

    // push each of the itemsToPush, one at a time.
    // itemsToPush starts with just [this], but pushOne can add more items to the stack.
    // Maximally, this could run through all Items on the screen.
    while (itemsToPush.length)
      pushOne(itemsToPush.shift());

    // ___ Squish!
    var pageBounds = Items.getSafeWindowBounds();
    items.forEach(function Item_pushAway_squish(item) {
      var data = item.pushAwayData;
      if (data.generation == 0)
        return;

      let apply = function Item_pushAway_squish_apply(item, posStep, posStep2, sizeStep) {
        var data = item.pushAwayData;
        if (data.generation == 0)
          return;

        var bounds = data.bounds;
        bounds.width -= sizeStep.x;
        bounds.height -= sizeStep.y;
        bounds.left += posStep.x;
        bounds.top += posStep.y;

        let validSize;
        validSize = Items.calcValidSize(
          new Point(bounds.width, bounds.height));
        bounds.width = validSize.x;
        bounds.height = validSize.y;

        var pusher = data.pusher;
        if (pusher) {
          var newPosStep = new Point(posStep.x + posStep2.x, posStep.y + posStep2.y);
          apply(pusher, newPosStep, posStep2, sizeStep);
        }
      }

      var bounds = data.bounds;
      var posStep = new Point();
      var posStep2 = new Point();
      var sizeStep = new Point();

      if (bounds.left < pageBounds.left) {
        posStep.x = pageBounds.left - bounds.left;
        sizeStep.x = posStep.x / data.generation;
        posStep2.x = -sizeStep.x;
      } else if (bounds.right > pageBounds.right) { // this may be less of a problem post-601534
        posStep.x = pageBounds.right - bounds.right;
        sizeStep.x = -posStep.x / data.generation;
        posStep.x += sizeStep.x;
        posStep2.x = sizeStep.x;
      }

      if (bounds.top < pageBounds.top) {
        posStep.y = pageBounds.top - bounds.top;
        sizeStep.y = posStep.y / data.generation;
        posStep2.y = -sizeStep.y;
      } else if (bounds.bottom > pageBounds.bottom) { // this may be less of a problem post-601534
        posStep.y = pageBounds.bottom - bounds.bottom;
        sizeStep.y = -posStep.y / data.generation;
        posStep.y += sizeStep.y;
        posStep2.y = sizeStep.y;
      }

      if (posStep.x || posStep.y || sizeStep.x || sizeStep.y)
        apply(item, posStep, posStep2, sizeStep);        
    });

    // ___ Unsquish
    var pairs = [];
    items.forEach(function Item_pushAway_setupUnsquish(item) {
      var data = item.pushAwayData;
      pairs.push({
        item: item,
        bounds: data.bounds
      });
    });

    Items.unsquish(pairs);

    // ___ Apply changes
    items.forEach(function Item_pushAway_setBounds(item) {
      var data = item.pushAwayData;
      var bounds = data.bounds;
      if (!bounds.equals(data.startBounds)) {
        item.setBounds(bounds, immediately);
      }
    });
  },

  // ----------
  // Function: setTrenches
  // Sets up/moves the trenches for snapping to this item.
  setTrenches: function Item_setTrenches(rect) {
    if (!this.borderTrenches)
      this.borderTrenches = Trenches.registerWithItem(this,"border");

    var bT = this.borderTrenches;
    Trenches.getById(bT.left).setWithRect(rect);
    Trenches.getById(bT.right).setWithRect(rect);
    Trenches.getById(bT.top).setWithRect(rect);
    Trenches.getById(bT.bottom).setWithRect(rect);

    if (!this.guideTrenches)
      this.guideTrenches = Trenches.registerWithItem(this,"guide");

    var gT = this.guideTrenches;
    Trenches.getById(gT.left).setWithRect(rect);
    Trenches.getById(gT.right).setWithRect(rect);
    Trenches.getById(gT.top).setWithRect(rect);
    Trenches.getById(gT.bottom).setWithRect(rect);
  },

  // ----------
  // Function: removeTrenches
  // Removes the trenches for snapping to this item.
  removeTrenches: function Item_removeTrenches() {
    for (var edge in this.borderTrenches) {
      Trenches.unregister(this.borderTrenches[edge]); // unregister can take an array
    }
    this.borderTrenches = null;
    for (var edge in this.guideTrenches) {
      Trenches.unregister(this.guideTrenches[edge]); // unregister can take an array
    }
    this.guideTrenches = null;
  },

  // ----------
  // Function: snap
  // The snap function used during item creation via drag-out
  //
  // Parameters:
  //  immediately - bool for having the drag do the final positioning without animation
  snap: function Item_snap(immediately) {
    // make the snapping work with a wider range!
    var defaultRadius = Trenches.defaultRadius;
    Trenches.defaultRadius = 2 * defaultRadius; // bump up from 10 to 20!

    var FauxDragInfo = new Drag(this, {});
    FauxDragInfo.snap('none', false);
    FauxDragInfo.stop(immediately);

    Trenches.defaultRadius = defaultRadius;
  },

  // ----------
  // Function: draggable
  // Enables dragging on this item. Note: not to be called multiple times on the same item!
  draggable: function Item_draggable() {
    try {
      Utils.assert(this.dragOptions, 'dragOptions');

      var cancelClasses = [];
      if (this.dragOptions && typeof this.dragOptions.cancelClass == 'string')
        cancelClasses = this.dragOptions.cancelClass.split(' ');

      var self = this;
      var $container = iQ(this.container);
      var startMouse;
      var startPos;
      var startSent;
      var startEvent;
      var droppables;
      var dropTarget;

      // determine the best drop target based on the current mouse coordinates
      let determineBestDropTarget = function (e, box) {
        // drop events
        var best = {
          dropTarget: null,
          score: 0
        };

        droppables.forEach(function(droppable) {
          var intersection = box.intersection(droppable.bounds);
          if (intersection && intersection.area() > best.score) {
            var possibleDropTarget = droppable.item;
            var accept = true;
            if (possibleDropTarget != dropTarget) {
              var dropOptions = possibleDropTarget.dropOptions;
              if (dropOptions && typeof dropOptions.accept == "function")
                accept = dropOptions.accept.apply(possibleDropTarget, [self]);
            }

            if (accept) {
              best.dropTarget = possibleDropTarget;
              best.score = intersection.area();
            }
          }
        });

        return best.dropTarget;
      }

      // ___ mousemove
      var handleMouseMove = function(e) {
        // global drag tracking
        drag.lastMoveTime = Date.now();

        // positioning
        var mouse = new Point(e.pageX, e.pageY);
        if (!startSent) {
          if(Math.abs(mouse.x - startMouse.x) > self.dragOptions.minDragDistance ||
             Math.abs(mouse.y - startMouse.y) > self.dragOptions.minDragDistance) {
            if (typeof self.dragOptions.start == "function")
              self.dragOptions.start.apply(self,
                  [startEvent, {position: {left: startPos.x, top: startPos.y}}]);
            startSent = true;
          }
        }
        if (startSent) {
          // drag events
          var box = self.getBounds();
          box.left = startPos.x + (mouse.x - startMouse.x);
          box.top = startPos.y + (mouse.y - startMouse.y);
          self.setBounds(box, true);

          if (typeof self.dragOptions.drag == "function")
            self.dragOptions.drag.apply(self, [e]);

          let bestDropTarget = determineBestDropTarget(e, box);

          if (bestDropTarget != dropTarget) {
            var dropOptions;
            if (dropTarget) {
              dropOptions = dropTarget.dropOptions;
              if (dropOptions && typeof dropOptions.out == "function")
                dropOptions.out.apply(dropTarget, [e]);
            }

            dropTarget = bestDropTarget;

            if (dropTarget) {
              dropOptions = dropTarget.dropOptions;
              if (dropOptions && typeof dropOptions.over == "function")
                dropOptions.over.apply(dropTarget, [e]);
            }
          }
          if (dropTarget) {
            dropOptions = dropTarget.dropOptions;
            if (dropOptions && typeof dropOptions.move == "function")
              dropOptions.move.apply(dropTarget, [e]);
          }
        }

        // Not sure why this is here, but it breaks
        // any interactions in content area.
        //e.preventDefault();
      };

      // ___ mouseup
      var handleMouseUp = function(e) {
        iQ(window)
          .unbind('mousemove', handleMouseMove)
          .unbind('mouseup', handleMouseUp);

        if (startSent && dropTarget) {
          var dropOptions = dropTarget.dropOptions;
          if (dropOptions && typeof dropOptions.drop == "function")
            dropOptions.drop.apply(dropTarget, [e]);
        }

        if (startSent && typeof self.dragOptions.stop == "function")
          self.dragOptions.stop.apply(self, [e]);

        // Not sure why this is here, but it breaks
        // any interactions in content area.
        //e.preventDefault();
      };

      // ___ mousedown
      $container.mousedown(function(e) {
        if (!Utils.isLeftClick(e))
          return;

        var cancel = false;
        var $target = iQ(e.target);
        cancelClasses.forEach(function(className) {
          if ($target.hasClass(className))
            cancel = true;
        });

        if (cancel) {
          e.preventDefault();
          return;
        }

        startMouse = new Point(e.pageX, e.pageY);
        let bounds = self.getBounds();
        startPos = bounds.position();
        startEvent = e;
        startSent = false;

        droppables = [];
        iQ('.iq-droppable').each(function(elem) {
          if (elem != self.container) {
            var item = Items.item(elem);
            droppables.push({
              item: item,
              bounds: item.getBounds()
            });
          }
        });

        dropTarget = determineBestDropTarget(e, bounds);

        iQ(window)
          .mousemove(handleMouseMove)
          .mouseup(handleMouseUp);

        // Not sure why this is here, but it breaks
        // any interactions in content area.
        //e.preventDefault();
      });
    } catch(e) {
      Utils.log(e);
    }
  },

  // ----------
  // Function: droppable
  // Enables or disables dropping on this item.
  droppable: function Item_droppable(value) {
    try {
      var $container = iQ(this.container);
      if (value) {
        Utils.assert(this.dropOptions, 'dropOptions');
        $container.addClass('iq-droppable');
      } else
        $container.removeClass('iq-droppable');
    } catch(e) {
      Utils.log(e);
    }
  },

  // ----------
  // Function: resizable
  // Enables or disables resizing of this item.
  resizable: function Item_resizable(value) {
    try {
      var $container = iQ(this.container);
      iQ('.iq-resizable-handle', $container).remove();

      if (!value) {
        $container.removeClass('iq-resizable');
      } else {
        Utils.assert(this.resizeOptions, 'resizeOptions');

        $container.addClass('iq-resizable');

        var self = this;
        var startMouse;
        var startSize;
        var startAspect;

        // ___ mousemove
        var handleMouseMove = function(e) {
          // global resize tracking
          resize.lastMoveTime = Date.now();

          var mouse = new Point(e.pageX, e.pageY);
          var box = self.getBounds();
          if (UI.rtl) {
            var minWidth = (self.resizeOptions.minWidth || 0);
            var oldWidth = box.width;
            if (minWidth != oldWidth || mouse.x < startMouse.x) {
              box.width = Math.max(minWidth, startSize.x - (mouse.x - startMouse.x));
              box.left -= box.width - oldWidth;
            }
          } else {
            box.width = Math.max(self.resizeOptions.minWidth || 0, startSize.x + (mouse.x - startMouse.x));
          }
          box.height = Math.max(self.resizeOptions.minHeight || 0, startSize.y + (mouse.y - startMouse.y));

          if (self.resizeOptions.aspectRatio) {
            if (startAspect < 1)
              box.height = box.width * startAspect;
            else
              box.width = box.height / startAspect;
          }

          self.setBounds(box, true);

          if (typeof self.resizeOptions.resize == "function")
            self.resizeOptions.resize.apply(self, [e]);

          e.preventDefault();
          e.stopPropagation();
        };

        // ___ mouseup
        var handleMouseUp = function(e) {
          iQ(window)
            .unbind('mousemove', handleMouseMove)
            .unbind('mouseup', handleMouseUp);

          if (typeof self.resizeOptions.stop == "function")
            self.resizeOptions.stop.apply(self, [e]);

          e.preventDefault();
          e.stopPropagation();
        };

        // ___ handle + mousedown
        iQ('<div>')
          .addClass('iq-resizable-handle iq-resizable-se')
          .appendTo($container)
          .mousedown(function(e) {
            if (!Utils.isLeftClick(e))
              return;

            startMouse = new Point(e.pageX, e.pageY);
            startSize = self.getBounds().size();
            startAspect = startSize.y / startSize.x;

            if (typeof self.resizeOptions.start == "function")
              self.resizeOptions.start.apply(self, [e]);

            iQ(window)
              .mousemove(handleMouseMove)
              .mouseup(handleMouseUp);

            e.preventDefault();
            e.stopPropagation();
          });
        }
    } catch(e) {
      Utils.log(e);
    }
  },

  // ----------
  // Function: toString
  // Prints [Item id=id] for debug use
  toString: function Item_toString() {
    return "[Item id=" + this.id + "]";
  },

  // ----------
  // Variable: defaultName
  // The prompt text for the title field.
  defaultName: 'Name this item',

  // ----------
  // Function: getStorageData
  // Returns all of the info worth storing about this item.
  getStorageData: function Item_getStorageData() {
    var data = {
      bounds: this.getBounds(),
      userSize: null,
      title: this.getTitle(),
      id: this.id
    };

    if (Utils.isPoint(this.userSize))
      data.userSize = new Point(this.userSize);

    return data;
  },

  // ----------
  // Function: save
  // Saves this item to persistent storage.
  save: function Item_save() {
    if (!this._inited || this._uninited) // too soon/late to save
      return;

    /*
    var data = this.getStorageData();
    if (Items.itemStorageSanity(data))
      Storage.saveItem(gWindow, data);
      */
  },

  // ----------
  // Function: deleteData
  // Deletes the item in the persistent storage.
  deleteData: function Item_deleteData() {
    this._uninited = true;
    //Storage.deleteItem(gWindow, this.id);
  },

  // ----------
  // Function: getTitle
  // Returns the title of this item as a string.
  getTitle: function Item_getTitle() {
    return this.$title ? this.$title.val() : '';
  },

  // ----------
  // Function: setTitle
  // Sets the title of this item with the given string
  setTitle: function Item_setTitle(value) {
    this.$title.val(value);
    this.save();
  },

  // ----------
  // Function: focusTitle
  // Hide the title's shield and focus the underlying input field.
  focusTitle: function Item_focusTitle() {
    this.$titleShield.hide();
    this.$title[0].focus();
  },

  // ----------
  // Function: setBounds
  // Sets the bounds with the given <Rect>, animating unless "immediately" is false.
  //
  // Parameters:
  //   inRect - a <Rect> giving the new bounds
  //   immediately - true if it should not animate; default false
  //   options - an object with additional parameters, see below
  //
  // Possible options:
  //   force - true to always update the DOM even if the bounds haven't changed; default false
  setBounds: function Item_setBounds(inRect, immediately, options) {
    Utils.assert(Utils.isRect(inRect), 'Item.setBounds: rect is not a real rectangle!');

    // Validate and conform passed in size
    let validSize = Items.calcValidSize(
      new Point(inRect.width, inRect.height));
    let rect = new Rect(inRect.left, inRect.top, validSize.x, validSize.y);

    if (!options)
      options = {};

    var titleHeight = this.$titlebar.height();

    // ___ Determine what has changed
    var css = {};
    var titlebarCSS = {};
    var contentCSS = {};

    if (rect.left != this.bounds.left || options.force)
      css.left = rect.left;

    if (rect.top != this.bounds.top || options.force)
      css.top = rect.top;

    if (rect.width != this.bounds.width || options.force) {
      css.width = rect.width;
      titlebarCSS.width = rect.width;
      contentCSS.width = rect.width;
    }

    if (rect.height != this.bounds.height || options.force) {
      css.height = rect.height;
      contentCSS.height = rect.height - titleHeight;
    }

    if (Utils.isEmptyObject(css))
      return;

    var offset = new Point(rect.left - this.bounds.left, rect.top - this.bounds.top);
    this.bounds = new Rect(rect);

    // ___ Update our representation
    if (immediately) {
      iQ(this.container).css(css);
      this.$titlebar.css(titlebarCSS);
    } else {
      iQ(this.container).animate(css, {
        duration: 350,
        easing: "tabviewBounce",
        complete: function() {
        }
      });

      this.$titlebar.animate(titlebarCSS, {
        duration: 350
      });
    }

    UI.clearShouldResizeItems();
    this.setTrenches(rect);
    this.save();
  },

  // ----------
  // Function: setZ
  // Set the Z order for the item's container
  setZ: function Item_setZ(value) {
    this.zIndex = value;
    iQ(this.container).css({zIndex: value});
  },

  // ----------
  // Function: close
  // Closes the item
  //
  // Parameters:
  //   options - An object with optional settings for this call.
  //
  // Options:
  //   immediately - (bool) if true, no animation will be used
  close: function Item_close(options) {
    Items.unregister(this);

    // remove unfreeze event handlers, if item size is frozen
    this._unfreezeItemSize({dontArrange: true});

    let self = this;
    let destroyItem = function () {
      iQ(self.container).remove();
      self.removeTrenches();
      Items.unsquish();
      self._sendToSubscribers("close");
      Items.updateCloseButtons();
    }

    if (options && options.immediately) {
      destroyItem();
    } else {
      iQ(this.container).animate({
        opacity: 0,
        "transform": "scale(.3)",
      }, {
        duration: 170,
        complete: destroyItem
      });
    }

    this.deleteData();
  },

  // ----------
  // Function: _makeLastActiveItemActive
  // Makes the last active item active.
  _makeLastActiveItemActive: function Item__makeLastActiveItemActive() {
    let item = Items.getLastActiveItem();
    if (item)
      UI.setActive(item);
  },

  // ----------
  // Function: destroy
  // Close the item.
  //
  // Parameters:
  //   options - An object with optional settings for this call.
  //
  // Options:
  //   immediately - (bool) if true, no animation will be used
  //
  // Returns true if the item has been closed, or false otherwise. A item
  // could not have been closed due to a tab with an onUnload handler (that
  // waits for user interaction).
  destroy: function Item_destroy(options) {
    let self = this;

    this.close(options);
    return true;
  },

  // ----------
  // Function: _freezeItemSize
  // Freezes current item size (when removing a child).
  //
  // Parameters:
  //   itemCount - the number of children before the last one was removed
  _freezeItemSize: function Item__freezeItemSize(itemCount) {
    let data = this._frozenItemSizeData;

    if (!data.lastItemCount) {
      let self = this;
      data.lastItemCount = itemCount;

      // we don't need to observe mouse movement when expanded because the
      // tray is closed when we leave it and collapse causes unfreezing
      if (!self.expanded) {
        // unfreeze item size when cursor is moved out of item bounds
        data.onMouseMove = function (e) {
          let cursor = new Point(e.pageX, e.pageY);
          if (!self.bounds.contains(cursor))
            self._unfreezeItemSize();
        }
        iQ(window).mousemove(data.onMouseMove);
      }
    }

    this.arrange({animate: true, count: data.lastItemCount});
  },

  // ----------
  // Function: _unfreezeItemSize
  // Unfreezes and updates item size.
  //
  // Parameters:
  //   options - various options (see below)
  //
  // Possible options:
  //   dontArrange - do not arrange items when unfreezing
  _unfreezeItemSize: function Item__unfreezeItemSize(options) {
    let data = this._frozenItemSizeData;
    if (!data.lastItemCount)
      return;

    if (!options || !options.dontArrange)
      this.arrange({animate: true});

    // unbind event listeners
    if (data.onMouseMove)
      iQ(window).unbind('mousemove', data.onMouseMove);

    // reset freeze status
    this._frozenItemSizeData = {};
  },

  // ----------
  // Function: _addHandlers
  // Helper routine for the constructor; adds various event handlers to the container.
  _addHandlers: function Item__addHandlers(container) {
    let self = this;
    let lastMouseDownTarget;

    container.mousedown(function(e) {
      let target = e.target;
      // only set the last mouse down target if it is a left click, not on the
      // close button, not on the expand button, not on the title bar and its
      // elements
      if (Utils.isLeftClick(e) &&
          self.$closeButton[0] != target &&
          self.$titlebar[0] != target &&
          !self.$titlebar.contains(target)) {
        lastMouseDownTarget = target;
      } else {
        lastMouseDownTarget = null;
      }
    });

    this.draggable();
    this.droppable(true);
  },

  // ----------
  // Function: setResizable
  // Sets whether the item is resizable and updates the UI accordingly.
  setResizable: function Item_setResizable(value, immediately) {
    var self = this;

    this.resizeOptions.minWidth = Items.minItemWidth;
    this.resizeOptions.minHeight = Items.minItemHeight;

    let start = this.resizeOptions.start;
    this.resizeOptions.start = function (event) {
      start.call(self, event);
      self._unfreezeItemSize();
    }

    if (value) {
      immediately ? this.$resizer.show() : this.$resizer.fadeIn();
      this.resizable(true);
    } else {
      immediately ? this.$resizer.hide() : this.$resizer.fadeOut();
      this.resizable(false);
    }
  },

  enterEditMode: function Item_enterEditMode() {
    var self = this
    var oldContent = self.$content.html()
    self.$content.html('')
    var textarea = iQ('<textarea></textarea>')
      .html(oldContent)
      .blur(function() {
        var newContent = textarea.val()
        textarea.remove()
        self.$content.html(newContent)
      })
      .appendTo(this.$content)

    // TODO: find a way to autofocus the textarea
  },

  onContentClick: function Item_enterEditMode() {
    // removeme
  },
})

// ##########
// Class: Items
// Singleton for managing all <Item>s.
var Items = {

  items: [],
  nextID: 1,
  _inited: false,
  _activeItem: null,
  _cleanupFunctions: [],
  _arrangePaused: false,
  _arrangesPending: [],
  _delayedModUpdates: [],
  _autoclosePaused: false,
  minItemHeight: 110,
  minItemWidth: 125,
  _lastActiveList: null,

  // ----------
  // Variable: defaultGutter
  // How far apart Items should be from each other and from bounds
  defaultGutter: 15,

  // ----------
  // Function: getTopLevelItems
  // Returns an array of all Items
  getTopLevelItems: function Items_getTopLevelItems() {
    return this.items

    /*
    var items = [];

    iQ('.tab, .item').each(function(elem) {
      var $this = iQ(elem);
      var item = $this.data('item');
      if (item && !$this.hasClass('phantom'))
        items.push(item);
    });

    return items;
    */
  },

  // ----------
  // Function: getPageBounds
  // Returns a <Rect> defining the area of the page <Item>s should stay within.
  getPageBounds: function Items_getPageBounds() {
    var width = Math.max(100, window.innerWidth);
    var height = Math.max(100, window.innerHeight);
    return new Rect(0, 0, width, height);
  },

  // ----------
  // Function: getSafeWindowBounds
  // Returns the bounds within which it is safe to place all non-stationary <Item>s.
  getSafeWindowBounds: function Items_getSafeWindowBounds() {
    // the safe bounds that would keep it "in the window"
    var gutter = Items.defaultGutter;
    // Here, I've set the top gutter separately, as the top of the window has its own
    // extra chrome which makes a large top gutter unnecessary.
    // TODO: set top gutter separately, elsewhere.
    var topGutter = 5;
    return new Rect(gutter, topGutter,
        window.innerWidth - 2 * gutter, window.innerHeight - gutter - topGutter);
  },

  // ----------
  // Function: arrange
  // Arranges the given items in a grid within the given bounds,
  // maximizing item size but maintaining standard tab aspect ratio for each
  //
  // Parameters:
  //   items - an array of <Item>s. Can be null, in which case we won't
  //     actually move anything.
  //   bounds - a <Rect> defining the space to arrange within
  //   options - an object with various properites (see below)
  //
  // Possible "options" properties:
  //   animate - whether to animate; default: true.
  //   z - the z index to set all the items; default: don't change z.
  //   return - if set to 'widthAndColumns', it'll return an object with the
  //     width of children and the columns.
  //   count - overrides the item count for layout purposes;
  //     default: the actual item count
  //   columns - (int) a preset number of columns to use
  //   dropPos - a <Point> which should have a one-tab space left open, used
  //             when a tab is dragged over.
  //
  // Returns:
  //   By default, an object with three properties: `rects`, the list of <Rect>s,
  //   `dropIndex`, the index which a dragged tab should have if dropped
  //   (null if no `dropPos` was specified), and the number of columns (`columns`).
  //   If the `return` option is set to 'widthAndColumns', an object with the
  //   width value of the child items (`childWidth`) and the number of columns
  //   (`columns`) is returned.
  arrange: function Items_arrange(items, bounds, options) {
    if (!options)
      options = {};
    var animate = "animate" in options ? options.animate : true;
    var immediately = !animate;

    var rects = [];

    var count = options.count || (items ? items.length : 0);
    if (options.addTab)
      count++;
    if (!count) {
      let dropIndex = (Utils.isPoint(options.dropPos)) ? 0 : null;
      return {rects: rects, dropIndex: dropIndex};
    }

    var columns = options.columns || 1;
    // We'll assume for the time being that all the items have the same styling
    // and that the margin is the same width around.
    var itemMargin = items && items.length ?
                       parseInt(iQ(items[0].container).css('margin-left')) : 0;
    var padding = itemMargin * 2;
    var rows;
    var tabWidth;
    var tabHeight;
    var totalHeight;

    function figure() {
      rows = Math.ceil(count / columns);
      let validSize = Items.calcValidSize(
        new Point((bounds.width - (padding * columns)) / columns, -1),
        options);
      tabWidth = validSize.x;
      tabHeight = validSize.y;

      totalHeight = (tabHeight * rows) + (padding * rows);    
    }

    figure();

    while (rows > 1 && totalHeight > bounds.height) {
      columns++;
      figure();
    }

    if (rows == 1) {
      let validSize = Items.calcValidSize(new Point(tabWidth,
        bounds.height - 2 * itemMargin), options);
      tabWidth = validSize.x;
      tabHeight = validSize.y;
    }
    
    if (options.return == 'widthAndColumns')
      return {childWidth: tabWidth, columns: columns};

    let initialOffset = 0;
    if (UI.rtl) {
      initialOffset = bounds.width - tabWidth - padding;
    }
    var box = new Rect(bounds.left + initialOffset, bounds.top, tabWidth, tabHeight);

    var column = 0;

    var dropIndex = false;
    var dropRect = false;
    if (Utils.isPoint(options.dropPos))
      dropRect = new Rect(options.dropPos.x, options.dropPos.y, 1, 1);
    for (let a = 0; a < count; a++) {
      // If we had a dropPos, see if this is where we should place it
      if (dropRect) {
        let activeBox = new Rect(box);
        activeBox.inset(-itemMargin - 1, -itemMargin - 1);
        // if the designated position (dropRect) is within the active box,
        // this is where, if we drop the tab being dragged, it should land!
        if (activeBox.contains(dropRect))
          dropIndex = a;
      }
      
      // record the box.
      rects.push(new Rect(box));

      box.left += (UI.rtl ? -1 : 1) * (box.width + padding);
      column++;
      if (column == columns) {
        box.left = bounds.left + initialOffset;
        box.top += box.height + padding;
        column = 0;
      }
    }

    return {rects: rects, dropIndex: dropIndex, columns: columns};
  },

  // ----------
  // Function: unsquish
  // Checks to see which items can now be unsquished.
  //
  // Parameters:
  //   pairs - an array of objects, each with two properties: item and bounds. The bounds are
  //     modified as appropriate, but the items are not changed. If pairs is null, the
  //     operation is performed directly on all of the top level items.
  //   ignore - an <Item> to not include in calculations (because it's about to be closed, for instance)
  unsquish: function Items_unsquish(pairs, ignore) {
    var pairsProvided = (pairs ? true : false);
    if (!pairsProvided) {
      var items = Items.getTopLevelItems();
      pairs = [];
      items.forEach(function(item) {
        pairs.push({
          item: item,
          bounds: item.getBounds()
        });
      });
    }

    var pageBounds = Items.getSafeWindowBounds();
    pairs.forEach(function(pair) {
      var item = pair.item;
      if (item == ignore)
        return;

      var bounds = pair.bounds;
      var newBounds = new Rect(bounds);

      var newSize;
      if (Utils.isPoint(item.userSize))
        newSize = new Point(item.userSize);
      else if (item.isAItem)
        newSize = Items.calcValidSize(
          new Point(Items.minItemWidth, -1));

      if (item.isAItem) {
          newBounds.width = Math.max(newBounds.width, newSize.x);
          newBounds.height = Math.max(newBounds.height, newSize.y);
      } else {
        if (bounds.width < newSize.x) {
          newBounds.width = newSize.x;
          newBounds.height = newSize.y;
        }
      }

      newBounds.left -= (newBounds.width - bounds.width) / 2;
      newBounds.top -= (newBounds.height - bounds.height) / 2;

      var offset = new Point();
      if (newBounds.left < pageBounds.left)
        offset.x = pageBounds.left - newBounds.left;
      else if (newBounds.right > pageBounds.right)
        offset.x = pageBounds.right - newBounds.right;

      if (newBounds.top < pageBounds.top)
        offset.y = pageBounds.top - newBounds.top;
      else if (newBounds.bottom > pageBounds.bottom)
        offset.y = pageBounds.bottom - newBounds.bottom;

      newBounds.offset(offset);

      if (!bounds.equals(newBounds)) {
        var blocked = false;
        pairs.forEach(function(pair2) {
          if (pair2 == pair || pair2.item == ignore)
            return;

          var bounds2 = pair2.bounds;
          if (bounds2.intersects(newBounds))
            blocked = true;
          return;
        });

        if (!blocked) {
          pair.bounds.copy(newBounds);
        }
      }
      return;
    });

    if (!pairsProvided) {
      pairs.forEach(function(pair) {
        pair.item.setBounds(pair.bounds);
      });
    }
  },

  // GROUPITEMS
  
  // ----------
  // Function: toString
  // Prints [Items] for debug use
  toString: function Items_toString() {
    return "[Items count=" + this.items.length + "]";
  },

  // ----------
  // Function: init
  init: function Items_init() {
    this._lastActiveList = new MRUList();
  },

  // ----------
  // Function: uninit
  uninit: function Items_uninit() {
    // call our cleanup functions
    this._cleanupFunctions.forEach(function(func) {
      func();
    });

    this._cleanupFunctions = [];

    // additional clean up
    this.items = null;
  },

  // ----------
  // Function: newItem
  // Creates a new empty item.
  newItem: function Items_newItem() {
    var bounds = new Rect(20, 20, 250, 200);
    return new Item([], {bounds: bounds, immediately: true});
  },

  // ----------
  // Function: pauseArrange
  // Bypass arrange() calls and collect for resolution in
  // resumeArrange()
  pauseArrange: function Items_pauseArrange() {
    Utils.assert(this._arrangePaused == false, 
      "pauseArrange has been called while already paused");
    Utils.assert(this._arrangesPending.length == 0, 
      "There are bypassed arrange() calls that haven't been resolved");
    this._arrangePaused = true;
  },

  // ----------
  // Function: pushArrange
  // Push an arrange() call and its arguments onto an array
  // to be resolved in resumeArrange()
  pushArrange: function Items_pushArrange(item, options) {
    Utils.assert(this._arrangePaused, 
      "Ensure pushArrange() called while arrange()s aren't paused"); 
    let i;
    for (i = 0; i < this._arrangesPending.length; i++)
      if (this._arrangesPending[i].item === item)
        break;
    let arrangeInfo = {
      item: item,
      options: options
    };
    if (i < this._arrangesPending.length)
      this._arrangesPending[i] = arrangeInfo;
    else
      this._arrangesPending.push(arrangeInfo);
  },

  // ----------
  // Function: resumeArrange
  // Resolve bypassed and collected arrange() calls
  resumeArrange: function Items_resumeArrange() {
    this._arrangePaused = false;
    for (let i = 0; i < this._arrangesPending.length; i++) {
      let g = this._arrangesPending[i];
      g.item.arrange(g.options);
    }
    this._arrangesPending = [];
  },

  // ----------
  // Function: getBoundingBox
  // Given an array of DOM elements, returns a <Rect> with (roughly) the union of their locations.
  getBoundingBox: function Items_getBoundingBox(els) {
    var bounds = [iQ(el).bounds() for each (el in els)];
    var left   = Math.min.apply({},[ b.left   for each (b in bounds) ]);
    var top    = Math.min.apply({},[ b.top    for each (b in bounds) ]);
    var right  = Math.max.apply({},[ b.right  for each (b in bounds) ]);
    var bottom = Math.max.apply({},[ b.bottom for each (b in bounds) ]);

    return new Rect(left, top, right-left, bottom-top);
  },

  // ----------
  // Function: reconstitute
  // Restores to stored state, creating items as needed.
  reconstitute: function Items_reconstitute(itemsData, itemData) {
    try {
      let activeItemId;

      if (itemsData) {
        if (itemsData.nextID)
          this.nextID = Math.max(this.nextID, itemsData.nextID);
        if (itemsData.activeItemId)
          activeItemId = itemsData.activeItemId;
      }

      if (itemData) {
        var toClose = this.items.concat();
        for (var id in itemData) {
          let data = itemData[id];
          if (this.itemStorageSanity(data)) {
            let item = this.item(data.id); 
            if (item) {
              item.userSize = data.userSize;
              item.setTitle(data.title);
              item.setBounds(data.bounds, true);
              
              let index = toClose.indexOf(item);
              if (index != -1)
                toClose.splice(index, 1);
            } else {
              var options = {
                dontPush: true,
                immediately: true
              };
  
              new Item([], Utils.extend({}, data, options));
            }
          }
        }

        toClose.forEach(function(item) {
          // this closes the item
          item.close({immediately: true});
        });
      }

      // set active item
      if (activeItemId) {
        let activeItem = this.item(activeItemId);
        if (activeItem)
          UI.setActive(activeItem);
      }

      this._inited = true;
      this._save(); // for nextID
    } catch(e) {
      Utils.log("error in recons: "+e);
    }
  },

  // ----------
  // Function: load
  // Loads the storage data for items. 
  // Returns true if there was global item data.
  load: function Items_load() {
    /*
    let itemsData = Storage.readItemsData(gWindow);
    let itemData = Storage.readItemData(gWindow);
    this.reconstitute(itemsData, itemData);
    
    return (itemsData && !Utils.isEmptyObject(itemsData));
    */
  },

  // ----------
  // Function: itemStorageSanity
  // Given persistent storage data for a item, returns true if it appears to not be damaged.
  itemStorageSanity: function Items_itemStorageSanity(itemData) {
    let sane = true;
    if (!itemData.bounds || !Utils.isRect(itemData.bounds)) {
      Utils.log('Items.itemStorageSanity: bad bounds', itemData.bounds);
      sane = false;
    } else if ((itemData.userSize && 
               !Utils.isPoint(itemData.userSize)) ||
               !itemData.id) {
      sane = false;
    }

    return sane;
  },

  // ----------
  // Function: register
  // Adds the given <Item> to the list of items we're tracking.
  register: function Items_register(item) {
    Utils.assert(item, 'item');
    Utils.assert(this.items.indexOf(item) == -1, 'only register once per item');
    this.items.push(item);
  },

  // ----------
  // Function: unregister
  // Removes the given <Item> from the list of items we're tracking.
  unregister: function Items_unregister(item) {
    var index = this.items.indexOf(item);
    if (index != -1)
      this.items.splice(index, 1);

    if (item == this._activeItem)
      this._activeItem = null;

    this._arrangesPending = this._arrangesPending.filter(function (pending) {
      return item != pending.item;
    });

    this._lastActiveList.remove(item);
  },

  // ----------
  // Function: item
  // Given some sort of identifier, returns the appropriate item.
  // Currently only supports item ids.
  // Given a DOM element representing an Item, returns the Item.
  item: function Items_item(a) {
    var node = iQ(a).data('item');
    if (node)
      return node

    var result = null;
    this.items.forEach(function(candidate) {
      if (candidate.id == a)
        result = candidate;
    });

    return result;
  },

  // ----------
  // Function: getActiveItem
  // Returns the active item. Active means its tabs are
  // shown in the tab bar when not in the TabView interface.
  getActiveItem: function Items_getActiveItem() {
    return this._activeItem;
  },

  // ----------
  // Function: setActiveItem
  // Sets the active item
  //
  // Paramaters:
  //  item - the active <Item>
  setActiveItem: function Items_setActiveItem(item) {
    Utils.assert(item, "item must be given");

    if (this._activeItem)
      iQ(this._activeItem.container).removeClass('activeItem');

    iQ(item.container).addClass('activeItem');

    this._lastActiveList.update(item);
    this._activeItem = item;
    //this._save();
  },

  // ----------
  // Function: getLastActiveItem
  // Gets last active item.
  // Returns the <item>. If nothing is found, return null.
  getLastActiveItem: function Item_getLastActiveItem() {
    return this._lastActiveList.peek(function(item) {
      return (item)
    });
  },

  // ----------
  // Function: updateCloseButtons
  // Updates item close buttons.
  updateCloseButtons: function Items_updateCloseButtons() {
    this.items.forEach(function(item) {
      item.$closeButton.show();
    });
  },
  
  // ----------
  // Function: calcValidSize
  // Basic measure rules. Assures that item is a minimum size.
  calcValidSize: function Items_calcValidSize(size, options) {
    Utils.assert(Utils.isPoint(size), 'input is a Point');
    Utils.assert((size.x>0 || size.y>0) && (size.x!=0 && size.y!=0), 
      "dimensions are valid:"+size.x+","+size.y);
    return new Point(
      Math.max(size.x, Items.minItemWidth),
      Math.max(size.y, Items.minItemHeight));
  },
}
