import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { google } from 'googleapis';

const CREDENTIALS_PATH = path.join(process.cwd(), 'gmail_credentials.json');
const TOKEN_PATH = path.join(process.cwd(), '.gmail_token.json');

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.labels',
];

async function main() {
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    console.error(
      'Error: gmail_credentials.json not found in project root.\n' +
        'Download it from Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client IDs'
    );
    process.exit(1);
  }

  const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf-8'));
  const { client_id, client_secret, redirect_uris } =
    credentials.installed || credentials.web;

  const oAuth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    redirect_uris?.[0] || 'urn:ietf:wg:oauth:2.0:oob'
  );

  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
  });

  console.log('\n🔗 Open this URL in your browser:\n');
  console.log(authUrl);
  console.log('\nAfter authorizing, paste the code here:\n');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  rl.question('Code: ', async (code) => {
    rl.close();

    try {
      const { tokens } = await oAuth2Client.getToken(code.trim());
      fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
      console.log('\n✅ Token saved to .gmail_token.json');
      console.log('Gmail integration is ready!');
    } catch (err: any) {
      console.error('Error exchanging code for token:', err.message);
      process.exit(1);
    }
  });
}

main();
