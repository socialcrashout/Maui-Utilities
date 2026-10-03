/**
 * Formats a timestamp (ms) as mm/dd/yy.
 */
function formatDate(ms) {
  const d = new Date(ms);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(-2);
  return `${mm}/${dd}/${yy}`;
}

module.exports = { formatDate };