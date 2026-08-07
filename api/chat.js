export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        error: "Thiếu GEMINI_API_KEY trong Environment Variables của Vercel."
      });
    }

    const { prompt, temperature } = req.body || {};

    if (!prompt) {
      return res.status(400).json({
        error: "Thiếu nội dung prompt."
      });
    }

    const model = process.env.GEMINI_TEXT_MODEL || "gemini-3.5-flash";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

    const body = {
      contents: [
        {
          role: "user",
          parts: [
            { text: prompt }
          ]
        }
      ],
      generationConfig: {
        temperature: temperature || 0.6,
        topP: 0.9,
        maxOutputTokens: 1200
      }
    };

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey
      },
      body: JSON.stringify(body)
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data?.error?.message || `Không gọi được Gemini text với model ${model}.`);
    }

    const text = data?.candidates?.[0]?.content?.parts
      ?.map((p) => p.text || "")
      .join("")
      .trim();

    if (!text) {
      throw new Error("Gemini không trả về nội dung text.");
    }

    return res.status(200).json({
      result: text
    });
  } catch (error) {
    console.error("Vercel api/chat error:", error);
    return res.status(500).json({
      error: error.message || "Lỗi server khi gọi Gemini."
    });
  }
}