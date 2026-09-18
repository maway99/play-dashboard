import { configureCompanionCueButtons } from './configure-main-cue-button.mjs';

await configureCompanionCueButtons(process.argv[2] ?? 'http://127.0.0.1:8000', [
  { column: 0, oldText: 'BEAMS', text: 'MED\nWHITE', variable: 'pgro_sd_build_med_white_press' },
  { column: 1, oldText: 'STROBES', text: 'FAST\nWHITE', variable: 'pgro_sd_build_fast_white_press' },
  { column: 2, oldText: 'HALF 1', text: 'MED\nSTROBE', variable: 'pgro_sd_build_med_strobe_press' },
  { column: 3, oldText: 'HALF 2', text: 'FAST\nSTROBE', variable: 'pgro_sd_build_fast_strobe_press' }
].map(target => ({ ...target, row: 2, heading: 'BUILD', oldHeading: 'HITS', backgroundColor: 0xa56d20 })),
'build-cues');
