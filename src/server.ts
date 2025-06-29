// backend/src/server.ts
import 'dotenv/config'; // .envファイルを読み込む
import express from 'express';
import { Pool, PoolClient } from 'pg';
import cors from 'cors';

const app = express();
const port = Number(process.env.PORT) || 3000;

app.use(cors({
    origin: ['http://localhost:5173', 'http://192.168.10.8:5173'], // ここにフロントエンドのURLを正確に設定してください
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type']
}));
app.use(express.json());

// PostgreSQL接続プールの設定
if (!process.env.DATABASE_URL) {
    console.error("エラー: DATABASE_URL 環境変数が設定されていません。");
    process.exit(1);
}

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    // 自宅サーバーのPostgreSQLではSSL設定が不要な場合が多いですが、
    // もしSSL/TLSを有効にしている場合は適切に設定してください
    // ssl: { rejectUnauthorized: false }
});

// DB接続テスト
pool.connect()
    .then(client => {
        console.log('PostgreSQLに接続成功！');
        client.release();
    })
    .catch(err => {
        console.error('PostgreSQL接続エラー:', err.stack);
        process.exit(1);
    });

// APIレスポンスの型定義
interface SearchApiResponse {
    search_query: string;
    weblio_url: string;
    skell_url: string;
    oxford_url: string;
}

// エラーレスポンスの型定義
interface ErrorApiResponse {
    error: string;
}

// APIエンドポイント
// ここを修正します：resの型定義からジェネリック型を削除し、res.json()で型アサーションを再適用
app.get('/api/search', (req: express.Request, res: express.Response) => {
    (async () => {
        console.log("バックエンド開始");
        const rawQuery = req.query.q;
        let search_string: string | undefined;

        if (typeof rawQuery === 'string') {
            search_string = rawQuery.trim();
        } else if (Array.isArray(rawQuery) && typeof rawQuery[0] === 'string') {
            search_string = rawQuery[0].trim();
        }

        if (!search_string || search_string === '') {
            // 型アサーションを再適用
            res.status(400).json({ error: '検索単語が必要です。' } as ErrorApiResponse);
            return;
        }

        const encodedSearchQuery = encodeURIComponent(search_string);
        const weblioUrl = `https://ejje.weblio.jp/content/${encodedSearchQuery}`;
        const skellUrl = `https://skell.sketchengine.eu/#result?lang=en&query=${encodedSearchQuery}&f=concordance`;
        const oxfordUrl = `https://www.oxfordlearnersdictionaries.com/definition/english/${encodedSearchQuery}?q=${encodedSearchQuery}`;

        let client: PoolClient | undefined;
        try {
            client = await pool.connect();

            await client.query(
                `INSERT INTO search_logs (search_string, weblio_url, skell_url, oxford_url) VALUES ($1, $2, $3, $4)`,
                [search_string, weblioUrl, skellUrl, oxfordUrl]
            );

            console.log(`Saved to DB: ${search_string}, ${weblioUrl}, ${skellUrl}, ${oxfordUrl}`);

            res.status(200).json({
                search_query: search_string,
                weblio_url: weblioUrl,
                skell_url: skellUrl,
                oxford_url: oxfordUrl
            } as SearchApiResponse);

        } catch (error) {
            console.error("DB操作エラー:", error);
            const errorMessage = (error instanceof Error) ? error.message : '不明なエラー';
            // 型アサーションを再適用
            res.status(500).json({ error: `サーバーエラーが発生しました: ${errorMessage}` } as ErrorApiResponse);
        } finally {
            if (client) {
                client.release();
            }
        }
    })();
});

// バックエンドサーバー起動
app.listen(port, '0.0.0.0', () => { // '0.0.0.0' を追加
    console.log(`バックエンドサーバーが http://localhost:${port} または ${port} で起動しました`);
});