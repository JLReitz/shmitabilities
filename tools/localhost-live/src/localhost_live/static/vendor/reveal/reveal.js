(function (root) {
  "use strict";
  function Deck() {}
  Deck.prototype.initialize = function () {};
  root.Reveal = {
    initialize: function () {
      return new Deck();
    },
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
