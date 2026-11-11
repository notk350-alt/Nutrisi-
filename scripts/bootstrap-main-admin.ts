#!/usr/bin/env tsx
/**
 * NutriBodySim — Isolated Main Administrator CLI Bootstrap Utility (MVS-B2.5B.2)
 *
 * Usage:
 *   npx tsx scripts/bootstrap-main-admin.ts --user-id="usr_admin" --operator="infra-lead@nutribodysim.org"
 *
 * Emergency Break-Glass Recovery:
 *   npx tsx scripts/bootstrap-main-admin.ts --user-id="usr_admin" --operator="infra-lead" --force-recovery --reason="Incident #402 Emergency recovery"
 */

import { executeBootstrapMainAdmin } from '../backend/auth/bootstrapMainAdmin';

function parseArgs(args: string[]): Record<string, string | boolean> {
  const result: Record<string, string | boolean> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--help' || arg === '-h') {
      result.help = true;
      continue;
    }

    if (arg === '--force-recovery' || arg === '--force') {
      result.forceRecovery = true;
      continue;
    }

    if (arg.startsWith('--user-id=')) {
      result.userId = arg.substring('--user-id='.length);
    } else if (arg === '--user-id' || arg === '-u') {
      result.userId = args[++i];
    } else if (arg.startsWith('--operator=')) {
      result.operator = arg.substring('--operator='.length);
    } else if (arg === '--operator' || arg === '-o') {
      result.operator = args[++i];
    } else if (arg.startsWith('--reason=')) {
      result.reason = arg.substring('--reason='.length);
    } else if (arg === '--reason' || arg === '-r') {
      result.reason = args[++i];
    } else if (arg.startsWith('--verify-email=')) {
      result.verifyEmail = arg.substring('--verify-email='.length);
    } else if (arg === '--verify-email') {
      result.verifyEmail = args[++i];
    }
  }

  return result;
}

function printUsage() {
  console.log(`
NutriBodySim — Secure Main Administrator Bootstrap CLI
======================================================

USAGE:
  npx tsx scripts/bootstrap-main-admin.ts [OPTIONS]

REQUIRED OPTIONS:
  --user-id, -u <id>         Target internal user ID to elevate (e.g. "usr_admin")
  --operator, -o <name>      Identifier of authorized operational personnel executing this CLI

OPTIONAL:
  --verify-email <email>     Optional cross-check against registered user email
  --force-recovery, --force  Emergency break-glass transfer if Main Admin is already initialized
  --reason, -r <text>        Mandatory justification for break-glass recovery (min 10 characters)
  --help, -h                 Display this help information

EXAMPLES:
  # Initial system provisioning:
  npx tsx scripts/bootstrap-main-admin.ts --user-id="usr_admin" --operator="ops-lead@nutribodysim.org"

  # Disaster recovery transfer:
  npx tsx scripts/bootstrap-main-admin.ts --user-id="usr_admin_2" --operator="sec-lead" --force-recovery --reason="Loss of primary credentials incident #123"
`);
}

async function main() {
  const argv = process.argv.slice(2);
  const options = parseArgs(argv);

  if (options.help || argv.length === 0) {
    printUsage();
    process.exit(options.help ? 0 : 1);
  }

  const userId = options.userId as string;
  const operator = options.operator as string;
  const reason = options.reason as string | undefined;
  const forceRecovery = Boolean(options.forceRecovery);
  const verifyEmail = options.verifyEmail as string | undefined;

  if (!userId) {
    console.error('ERROR: Missing required option: --user-id (or -u)');
    process.exit(1);
  }

  if (!operator) {
    console.error('ERROR: Missing required option: --operator (or -o)');
    process.exit(1);
  }

  console.log(`[BOOTSTRAP] Executing Main Administrator provisioning...`);
  console.log(`  Target User ID: ${userId}`);
  console.log(`  Operator:       ${operator}`);
  console.log(`  Mode:           ${forceRecovery ? 'BREAK_GLASS_RECOVERY' : 'INITIAL_PROVISIONING'}`);

  try {
    const result = await executeBootstrapMainAdmin({
      targetUserId: userId,
      operator,
      reason,
      forceRecovery,
      verifyEmail,
      ipAddress: '127.0.0.1 (CLI_SHELL)'
    });

    console.log(`\n[SUCCESS] ${result.message}`);
    console.log(`  User ID:             ${result.user.id}`);
    console.log(`  Name:                ${result.user.name}`);
    console.log(`  Role:                ${result.user.role}`);
    console.log(`  is_main_admin:       ${result.user.is_main_admin}`);
    console.log(`  Permissions:         [${result.user.permissions.join(', ')}]`);
    console.log(`  Governance Granted:  ${result.user.governance_granted_at} by ${result.user.governance_granted_by}`);
    console.log(`  Audit Log ID:        ${result.auditLog.id}`);
    if (result.previousMainAdmin) {
      console.log(`  Previous Main Admin: ${result.previousMainAdmin.name} (${result.previousMainAdmin.id}) [REVOKED]`);
    }
    process.exit(0);
  } catch (error: any) {
    console.error(`\n[BOOTSTRAP_FAILURE] ${error.message}`);
    process.exit(1);
  }
}

main();
