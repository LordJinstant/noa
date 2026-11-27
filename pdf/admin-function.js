// Minimal admin-function.js — AI train helpers live inline in admin.html.
// Placeholder for activity chart and other dashboard features that were previously external.
(function () {
  function loadActivityChart() {
    // Optional: implement Chart.js activity graph if canvas#activityChart exists
    var canvas = document.getElementById('activityChart');
    if (!canvas || typeof Chart === 'undefined') return;
  }
  window.loadActivityChart = loadActivityChart;
  document.addEventListener('DOMContentLoaded', function () {
    try { loadActivityChart(); } catch (e) {}
  });
})();
