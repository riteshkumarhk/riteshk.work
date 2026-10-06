import { readFileSync, statSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { evaluateHeadlineCalibration, evaluateAssessmentQuality } from './resume-assessment-quality.mjs';

try {
  const { values } = parseArgs({ options: { input: { type: 'string' }, mode: { type: 'string' } }, allowPositionals: false });
  if (!values.input || !['quality', 'calibration'].includes(values.mode)) throw new Error('Choose --input <local JSON file> and --mode quality|calibration. This command never runs a provider.');
  const stat = statSync(values.input);
  if (!stat.isFile() || stat.size > 4 * 1024 * 1024) throw new Error('Choose a regular evaluation JSON file no larger than 4 MB.');
  let input;
  try { input = JSON.parse(readFileSync(values.input, 'utf8')); }
  catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new Error('Evaluation input is not valid JSON.', { cause: error });
  }
  const result = await (values.mode === 'quality' ? evaluateAssessmentQuality(input) : evaluateHeadlineCalibration(input));
  console.log(JSON.stringify(result, null, 2));
  if (!result.criteriaMet) process.exitCode = 2;
} catch (error) {
  console.error('Offline evaluation failed: ' + error.message);
  process.exitCode = 1;
}
