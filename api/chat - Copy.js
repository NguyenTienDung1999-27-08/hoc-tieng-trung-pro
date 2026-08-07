export default async function handler(req, res) {
  // 1. Chỉ nhận yêu cầu POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: "Chỉ chấp nhận phương thức POST" });
  }

  // 2. Lấy Key từ cấu hình Vercel
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

  // Kiểm tra xem Key đã được nạp chưa
  if (!GEMINI_API_KEY || GEMINI_API_KEY === "") {
    return res.status(500).json({ error: "Lỗi Server: Chưa cấu hình GEMINI_API_KEY trên Vercel!" });
  }

  try {
    const { prompt } = req.body;
    
    // 3. Gọi API Google Gemini
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ 
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.35, maxOutputTokens: 500 }
      })
    });

    const data = await response.json();

    // 4. Kiểm tra phản hồi từ Google
    if (!response.ok) {
        return res.status(response.status).json({ error: data.error?.message || "Lỗi từ API Google" });
    }

    return res.status(200).json(data);

  } catch (error) {
    return res.status(500).json({ error: "Lỗi kết nối tới Google AI: " + error.message });
  }
}