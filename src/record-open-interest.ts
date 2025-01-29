import { type IdlAccounts } from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import { Perpetuals } from "./idl/jupiter-perpetuals-idl";
import { CUSTODY_PUBKEY, JUPITER_PERPETUALS_PROGRAM, USDC_DECIMALS } from "./constants";
import { BNToUSDRepresentation, sendTelegramMessage } from "./utils";
import { Pool } from 'pg';
import cron from 'node-cron';
import dotenv from 'dotenv';

dotenv.config();

// Create a new pool connection
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: parseInt(process.env.DB_PORT || '5432'),
});

const OI_DIFF_THRESHOLD = 10_000_000;

export async function getOpenInterest() {
  try {
    const gpaResult =
      await JUPITER_PERPETUALS_PROGRAM.provider.connection.getProgramAccounts(
        JUPITER_PERPETUALS_PROGRAM.programId,
        {
          commitment: "confirmed",
          filters: [
            {
              memcmp:
                JUPITER_PERPETUALS_PROGRAM.coder.accounts.memcmp("position"),
            },
          ],
        },
      );

    const positions = gpaResult.map((item) => {
      return {
        publicKey: item.pubkey,
        account: JUPITER_PERPETUALS_PROGRAM.coder.accounts.decode(
          "position",
          item.account.data,
        ) as IdlAccounts<Perpetuals>["position"],
      };
    });

    // Old positions accounts are not closed, but have `sizeUsd = 0`
    // i.e. open positions have a non-zero `sizeUsd`
    const openPositions = positions.filter((position) =>
      position.account.sizeUsd.gtn(0),
    );

    let openSolLongInterest = new BN(0);
    let openSolShortInterest = new BN(0);
    let openBtcLongInterest = new BN(0);
    let openBtcShortInterest = new BN(0);
    let openEthLongInterest = new BN(0);
    let openEthShortInterest = new BN(0);

    for (const position of openPositions) {
      if (position.account.custody.toBase58() === CUSTODY_PUBKEY.SOL && position.account.side.long) {
        openSolLongInterest = position.account.sizeUsd.add(openSolLongInterest);
      }
      if (position.account.custody.toBase58() === CUSTODY_PUBKEY.SOL && !position.account.side.long) {
        openSolShortInterest = position.account.sizeUsd.add(openSolShortInterest);
      }
      if (position.account.custody.toBase58() === CUSTODY_PUBKEY.BTC && position.account.side.long) {
        openBtcLongInterest = position.account.sizeUsd.add(openBtcLongInterest);
      }
      if (position.account.custody.toBase58() === CUSTODY_PUBKEY.BTC && !position.account.side.long) {
        openBtcShortInterest = position.account.sizeUsd.add(openBtcShortInterest);
      }
      if (position.account.custody.toBase58() === CUSTODY_PUBKEY.ETH && position.account.side.long) {
        openEthLongInterest = position.account.sizeUsd.add(openEthLongInterest);
      }
      if (position.account.custody.toBase58() === CUSTODY_PUBKEY.ETH && !position.account.side.long) {
        openEthShortInterest = position.account.sizeUsd.add(openEthShortInterest);
      }
    }

    const data = {
        sol_long_interest: parseFloat(BNToUSDRepresentation(openSolLongInterest, USDC_DECIMALS)),
        sol_short_interest: parseFloat(BNToUSDRepresentation(openSolShortInterest, USDC_DECIMALS)),
        btc_long_interest: parseFloat(BNToUSDRepresentation(openBtcLongInterest, USDC_DECIMALS)),
        btc_short_interest: parseFloat(BNToUSDRepresentation(openBtcShortInterest, USDC_DECIMALS)),
        eth_long_interest: parseFloat(BNToUSDRepresentation(openEthLongInterest, USDC_DECIMALS)),
        eth_short_interest: parseFloat(BNToUSDRepresentation(openEthShortInterest, USDC_DECIMALS))
    };

    return data;
  } catch (error) {
    console.error("Failed to fetch open positions", error);
  }
}

// This function returns all open positions and stores them in the database
export async function getAndStoreOpenPositions() {
  try {
    const data = await getOpenInterest();
    if (!data) {
      throw new Error('Failed to get open positions data');
    }

    // Get the most recent record
    const getQuery = `
      SELECT * FROM open_interest ORDER BY timestamp DESC LIMIT 1
    `;
    const result = await pool.query(getQuery);
    const mostRecentRecord = result.rows[0];

    if (mostRecentRecord) {
      // Add type assertion for key
      const sol_recent_total = mostRecentRecord.sol_long_interest - mostRecentRecord.sol_short_interest;
      const btc_recent_total = mostRecentRecord.btc_long_interest - mostRecentRecord.btc_short_interest;
      const eth_recent_total = mostRecentRecord.eth_long_interest - mostRecentRecord.eth_short_interest;
      const sol_current_total = data.sol_long_interest - data.sol_short_interest;
      const btc_current_total = data.btc_long_interest - data.btc_short_interest;
      const eth_current_total = data.eth_long_interest - data.eth_short_interest;


      const sol_diff_ratio = Math.abs(sol_current_total - sol_recent_total) / sol_recent_total;
      const btc_diff_ratio = Math.abs(btc_current_total - btc_recent_total) / btc_recent_total;
      const eth_diff_ratio = Math.abs(eth_current_total - eth_recent_total) / eth_recent_total;
      const sol_diff = Math.abs(sol_current_total - sol_recent_total);
      const btc_diff = Math.abs(btc_current_total - btc_recent_total);
      const eth_diff = Math.abs(eth_current_total - eth_recent_total);

      if ((sol_diff_ratio > 0.1 && sol_diff > OI_DIFF_THRESHOLD) || (btc_diff_ratio > 0.1 && btc_diff > OI_DIFF_THRESHOLD) || (eth_diff_ratio > 0.1 && eth_diff > OI_DIFF_THRESHOLD)) {
        console.log(`Difference of oi is over 10%: SOL: ${sol_diff_ratio}, ${sol_diff} - BTC: ${btc_diff_ratio}, ${btc_diff} - ETH: ${eth_diff_ratio}, ${eth_diff}`);
        console.log(`Current OI: SOL: ${sol_current_total} - BTC: ${btc_current_total} - ETH: ${eth_current_total}`);
        console.log(`Last OI: SOL: ${sol_recent_total} - BTC: ${btc_recent_total} - ETH: ${eth_recent_total}`);
        // Send a notification to the telegram channel
        const telegramMessage = `Difference of oi is over 10%: SOL: ${sol_diff_ratio}, ${sol_diff} - BTC: ${btc_diff_ratio}, ${btc_diff} - ETH: ${eth_diff_ratio}, ${eth_diff}`;
        await sendTelegramMessage(telegramMessage);
      }
    } else {
      console.log("No previous records found");
    }

    const insertQuery = `
      INSERT INTO open_interest 
      (sol_long_interest, sol_short_interest, btc_long_interest, btc_short_interest, eth_long_interest, eth_short_interest)
      VALUES ($1, $2, $3, $4, $5, $6)
    `;

    await pool.query(insertQuery, Object.values(data));
    console.log("Data stored successfully:", data);
  } catch (error) {
    console.error("Failed to fetch and store open positions", error);
  }
}

// Run the function once to get the initial data
getAndStoreOpenPositions();

// Schedule the function to run every 5 minutes
cron.schedule('*/5 * * * *', async () => {
  console.log(`${new Date().toISOString()} - Running open interest tracker...`);
  await getAndStoreOpenPositions();
});

// Keep the process running
process.on('SIGINT', async () => {
  await pool.end();
  process.exit(0);
});
