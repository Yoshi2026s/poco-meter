// 50 distinct shipped surfaces and states × 20 display profiles.
// Each test is separately named; the suite is not 1,000 repeated identical runs.
process.env.POCOCHA_COLOR_AUDIT_PROFILE='1000';
await import('./theme-visibility-100.mjs');
