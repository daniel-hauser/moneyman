#!/usr/bin/env node

/**
 * Script to generate ACCOUNTS_JSON configurations for GitHub secrets
 * Usage: node generate-accounts-config.js
 */

import readline from 'readline';

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const supportedBanks = {
    'hapoalim': { fields: ['userCode', 'password'], name: 'Bank Hapoalim' },
    'leumi': { fields: ['username', 'password'], name: 'Bank Leumi' },
    'mizrahi': { fields: ['username', 'password'], name: 'Mizrahi Tefahot Bank' },
    'discount': { fields: ['username', 'password'], name: 'Israel Discount Bank' },
    'visaCal': { fields: ['username', 'password'], name: 'Visa Cal' },
    'max': { fields: ['username', 'password'], name: 'Max (formerly Leumi Card)' },
    'isracard': { fields: ['username', 'password'], name: 'Isracard' },
    'amex': { fields: ['username', 'password'], name: 'American Express Israel' },
    'otsarHahayal': { fields: ['username', 'password'], name: 'Otsar Ha-Hayal Bank' },
    'beinleumi': { fields: ['username', 'password'], name: 'Bank Beinleumi' },
    'masad': { fields: ['username', 'password'], name: 'Bank Massad' },
    'yahav': { fields: ['username', 'password'], name: 'Bank Yahav' }
};

function question(prompt) {
    return new Promise((resolve) => {
        rl.question(prompt, resolve);
    });
}

async function generateConfig() {
    console.log('🏦 Moneyman Accounts Configuration Generator\n');
    console.log('This script will help you generate ACCOUNTS_JSON configurations for GitHub secrets.\n');

    const accounts = [];
    let addMore = true;

    while (addMore) {
        console.log('\n📋 Supported Banks:');
        Object.entries(supportedBanks).forEach(([id, info], index) => {
            console.log(`${index + 1}. ${info.name} (${id})`);
        });

        const bankChoice = await question('\nEnter bank number or companyId: ');
        let companyId;

        if (/^\d+$/.test(bankChoice)) {
            const index = parseInt(bankChoice) - 1;
            companyId = Object.keys(supportedBanks)[index];
        } else {
            companyId = bankChoice;
        }

        if (!supportedBanks[companyId]) {
            console.log('❌ Invalid bank selection. Please try again.');
            continue;
        }

        const bank = supportedBanks[companyId];
        console.log(`\n🏦 Configuring ${bank.name} (${companyId})`);

        const account = { companyId };

        for (const field of bank.fields) {
            const value = await question(`Enter ${field}: `);
            account[field] = value;
        }

        accounts.push(account);
        console.log('✅ Account added successfully!');

        const continueChoice = await question('\nAdd another account? (y/n): ');
        addMore = continueChoice.toLowerCase() === 'y' || continueChoice.toLowerCase() === 'yes';
    }

    const jsonConfig = JSON.stringify(accounts, null, 2);

    console.log('\n🎉 Generated Configuration:');
    console.log('='.repeat(50));
    console.log(jsonConfig);
    console.log('='.repeat(50));

    console.log('\n📋 Next Steps:');
    console.log('1. Copy the JSON configuration above');
    console.log('2. Go to your GitHub repository → Settings → Secrets and variables → Actions');
    console.log('3. Create a new repository secret with the name:');
    console.log('   - ACCOUNTS_JSON_MONDAY_STORAGE (for monday-storage branch)');
    console.log('   - ACCOUNTS_JSON_INVOICES (for invoices branch)');
    console.log('4. Paste the JSON configuration as the secret value');

    rl.close();
}

generateConfig().catch(console.error);
