import { createResume, resumeSignature, resumeFields } from './resume-workspace.mjs';

export const SAMPLE_EVIDENCE = 'Avery Rao led discovery and product design for Northstar, a B2B operations platform. Interviewed 24 operations leads and partnered with engineering and analytics. Redesigned onboarding, reducing median setup time by 32% and improving activation by 18%. Created a shared component library adopted by 6 product teams. At Common Ground, Avery designed customer support workflows and ran usability studies with 16 participants. A clearer triage workflow reduced handling time by 21%. All names and outcomes in this sample are fictional.';

export function sampleResumes(sourceId) {
  const model = { name: 'Avery Rao', title: 'Staff Product Designer', contact: { email: 'avery@example.test', phone: '+1 415 555 0142', location: 'San Francisco, CA', links: [{ id: 'portfolio', label: 'Portfolio', url: 'https://example.test/avery' }, { id: 'linkedin', label: 'LinkedIn', url: 'https://www.linkedin.com/in/example' }] }, summary: 'Product designer shaping complex workflows into clear, useful experiences. I connect research, systems thinking and cross-functional delivery to measurable customer outcomes.', sections: [
    { id: 'experience', heading: 'Experience', kind: 'experience', items: [
      { id: 'northstar', role: 'Lead Product Designer', org: 'Northstar', dates: '2021 - Present', location: 'San Francisco', bullets: [
        { id: 'onboarding', text: 'I worked with engineering and analytics on the onboarding redesign, which reduced median setup time by 32% and improved activation by 18%.' },
        { id: 'research', text: 'Interviewed 24 operations leads to identify bottlenecks and align the team around a clearer product direction.' },
        { id: 'systems', text: 'Created a shared component library adopted by 6 product teams, supporting more consistent workflows.' }
      ] },
      { id: 'common', role: 'Product Designer', org: 'Common Ground', dates: '2018 - 2021', location: 'Remote', bullets: [
        { id: 'triage', text: 'Designed a clearer customer support triage workflow, reducing handling time by 21%.' },
        { id: 'studies', text: 'Ran usability studies with 16 participants and translated findings into iterative workflow improvements.' }
      ] }
    ] },
    { id: 'skills', heading: 'Capabilities', kind: 'skills', groups: [{ id: 'methods', label: 'Practice', items: ['Product strategy', 'User research', 'Interaction design', 'Design systems', 'Prototyping'] }, { id: 'tools', label: 'Tools', items: ['Figma', 'FigJam', 'Dovetail', 'HTML / CSS'] }] },
    { id: 'education', heading: 'Education', kind: 'education', items: [{ id: 'school', school: 'Pacific Design Institute', credential: 'B.Des. Interaction Design', dates: '2018', note: '' }] }
  ] };
  const target = { company: 'Meridian', role: 'Staff Product Designer', level: 'staff', jd: 'Staff Product Designer - Meridian\n\nRequirements\nLead product strategy for complex B2B workflows. Partner with engineering and product management. Conduct user research, synthesize insights and deliver interaction design. Build design systems and accessible experiences. Strong Figma and prototyping skills. Communicate decisions with measurable customer outcomes.\n\nPreferred\nExperience with accessibility audits and SQL.' };
  return [createResume({ id: 'avery-meridian', name: 'Meridian / Staff Product Designer', target, model, sourceIds: [sourceId] }), createResume({ id: 'avery-master', name: 'Master resume', model, sourceIds: [sourceId], design: { accent: '#2f6d9a' } })];
}

export function sampleProposals(document, sources) {
  const source = sources.find(source => document.sourceIds.includes(source.id) && source.text.includes('reducing median setup time by 32%'));
  if (!source) return [];
  const field = resumeFields(document.model).find(field => field.id === 'onboarding');
  if (!field?.value.startsWith('I worked with')) return [];
  return [{ id: 'outcome-first', signature: resumeSignature(document), fieldId: field.id, before: field.value, after: 'Redesigned onboarding with engineering and analytics, reducing median setup time by 32% and improving activation by 18%.', title: 'Lead with the outcome and ownership', reason: 'Keep the collaboration and both verified outcomes while removing introductory wording.', evidence: [{ sourceId: source.id, quote: 'Redesigned onboarding, reducing median setup time by 32% and improving activation by 18%.' }] }];
}