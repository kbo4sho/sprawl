/**
 * Validate environment and configuration at startup
 * Log warnings for missing optional vars, error for critical ones
 */
function validateEnvironment() {
  const warnings = [];
  const errors = [];
  
  // Optional but recommended
  if (!process.env.ADMIN_SECRET) {
    warnings.push('ADMIN_SECRET not set - using default "sprawl-admin"');
  }
  
  if (!process.env.EVOLVE_SECRET) {
    warnings.push('EVOLVE_SECRET not set - using default "dev-secret"');
  }
  
  if (!process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY) {
    warnings.push('No LLM API key configured - agent evolution will be disabled');
  }
  
  if (!process.env.STRIPE_SECRET_KEY) {
    warnings.push('STRIPE_SECRET_KEY not set - payment features disabled');
  }
  
  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    warnings.push('STRIPE_WEBHOOK_SECRET not set - webhook signature verification disabled');
  }
  
  // Log results
  if (warnings.length > 0) {
    console.log('\n⚠ Configuration warnings:');
    warnings.forEach(w => console.log(`  - ${w}`));
  }
  
  if (errors.length > 0) {
    console.error('\n❌ Configuration errors:');
    errors.forEach(e => console.error(`  - ${e}`));
    throw new Error('Environment validation failed');
  }
  
  if (warnings.length === 0 && errors.length === 0) {
    console.log('✅ Environment validation passed');
  }
}

module.exports = { validateEnvironment };
