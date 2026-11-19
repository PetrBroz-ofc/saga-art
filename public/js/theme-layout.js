'use strict';
// Sága Art: pořadí a viditelnost sekcí podle nastavení v administraci. Spouští se hned po patičce, ještě než se
// rozjedou animace, aby se stránka nepřeskládávala. Samotnou logiku má js/theme.js (window.SaTheme).
(() => { if (window.SaTheme) window.SaTheme.layout(); })();
