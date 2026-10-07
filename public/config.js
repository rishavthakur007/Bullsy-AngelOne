/* Optional settings. Bullsy needs none of them: the game runs from data.json alone.

   The "Ask the AI coach" button needs the optional Bullsy server (npm start) with an
   AI key set on it. To switch the button on, set BULLSY_COACH to true and, if that
   server is on a different address from this site, put its address in BULLSY_API_BASE.
   These are addresses and switches, not secrets. Never put keys in this file. */
window.BULLSY_COACH = false;
window.BULLSY_API_BASE = "";
