import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [domain, template = 'mogaesup.com'] = process.argv.slice(2);
if (!domain) {
  console.log('usage: node scripts/register-domain.mjs <domain> [template-domain]');
  process.exit(1);
}

const aws = (args) => JSON.parse(execFileSync('aws', [...args, '--region', 'us-east-1', '--output', 'json'], { encoding: 'utf8' }));

const availability = aws(['route53domains', 'check-domain-availability', '--domain-name', domain]);
if (availability.Availability !== 'AVAILABLE') {
  console.log('not available:', availability.Availability);
  process.exit(1);
}

const detail = aws(['route53domains', 'get-domain-detail', '--domain-name', template]);
const strip = (c) => {
  const out = { ...c };
  for (const key of Object.keys(out)) if (out[key] === null || out[key] === undefined || out[key] === '') delete out[key];
  return out;
};
const input = {
  DomainName: domain,
  DurationInYears: 1,
  AutoRenew: true,
  AdminContact: strip(detail.AdminContact),
  RegistrantContact: strip(detail.RegistrantContact),
  TechContact: strip(detail.TechContact),
  PrivacyProtectAdminContact: true,
  PrivacyProtectRegistrantContact: true,
  PrivacyProtectTechContact: true,
};
const dir = mkdtempSync(join(tmpdir(), 'r53-'));
const file = join(dir, 'input.json');
writeFileSync(file, JSON.stringify(input));
try {
  const result = aws(['route53domains', 'register-domain', '--cli-input-json', `file://${file}`]);
  console.log('operation', result.OperationId);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
