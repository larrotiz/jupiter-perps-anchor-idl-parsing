CREATE TABLE open_interest (
    id SERIAL PRIMARY KEY,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    sol_long_interest NUMERIC,
    sol_short_interest NUMERIC,
    btc_long_interest NUMERIC,
    btc_short_interest NUMERIC,
    eth_long_interest NUMERIC,
    eth_short_interest NUMERIC
); 