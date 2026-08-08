module.exports = async function (req, res) {
  // CORS config
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Chỉ chấp nhận phương thức POST" });
  }

  try {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "Thiếu GROQ_API_KEY trên Vercel." });
    }

    // Đổi mới: Nhận cả mảng `messages` từ Frontend thay vì chỉ `prompt`
    const { messages, prompt, temperature } = req.body || {};
    if (!messages && !prompt) {
      return res.status(400).json({ error: "Thiếu nội dung hội thoại." });
    }

    const systemInstruction = `BẠN ĐANG TRẢ DỮ LIỆU CHO HỆ THỐNG XỬ LÝ ÂM THANH TỰ ĐỘNG. NẾU BẠN VI PHẠM ĐỊNH DẠNG, HỆ THỐNG SẼ BỊ LỖI (CRASH).

QUY TẮC ĐỊNH DẠNG TỐI THƯỢNG (KHÔNG ĐƯỢC LÀM TRÁI):
1. KHÔNG BAO GIỜ được dùng các từ nối như "là", "nghĩa là", "có nghĩa là" hoặc dấu "-" để viết chung tiếng Trung và tiếng Việt trên cùng 1 dòng.
2. Tiếng Trung và Pinyin (trong ngoặc tròn) PHẢI đứng một mình một dòng.
3. Tiếng Việt PHẢI bị ép xuống dòng ngay bên dưới.

[VÍ DỤ SAI - TUYỆT ĐỐI CẤM]:
摩托车 (mótuōchē) là xe máy.

[VÍ DỤ ĐÚNG - YÊU CẦU BẮT BUỘC]:
摩托车 (mótuōchē)
Xe máy.

QUY TẮC HỘI THOẠI:
- Phải đọc kỹ lịch sử chat.
- Nếu người dùng yêu cầu "chỉ nói tiếng Trung" -> Tuyệt đối không xuất ra tiếng Việt.
- Nếu người dùng dặn "không lấy ví dụ" -> Tuyệt đối không tự ý đẻ thêm câu ví dụ thừa thãi. Hãy trả lời ngắn gọn đúng trọng tâm.`;

    // Khởi tạo mảng hội thoại gửi lên Groq
    let finalMessages = [{ role: "system", content: systemInstruction }];

    // Nếu Frontend gửi lên mảng lịch sử chat (Hướng 1)
    if (messages && Array.isArray(messages) && messages.length > 0) {
      // Bí kíp: Nhồi thêm lời nhắc ngầm vào đuôi câu hỏi mới nhất của người dùng
      const lastIndex = messages.length - 1;
      if (messages[lastIndex].role === "user") {
         messages[lastIndex].content += "\n\n(Lưu ý: Đọc kỹ lịch sử chat, tuân thủ đúng yêu cầu của người dùng và nhớ giữ định dạng Pinyin ngoặc tròn).";
      }
      finalMessages = finalMessages.concat(messages);
    } 
    // Fallback dự phòng nếu Frontend chưa kịp sửa, vẫn gửi kiểu cũ
    else if (prompt) {
      finalMessages.push({ 
        role: "user", 
        content: prompt + "\n\n(Lưu ý: Tuân thủ quy tắc định dạng Pinyin ngoặc tròn và xuống dòng rõ ràng)." 
      });
    }

    const groqUrl = "https://api.groq.com/openai/v1/chat/completions";

    const textResponse = await fetch(groqUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: finalMessages,
        temperature: temperature || 0.6,
        stream: false
      })
    });

    const textData = await textResponse.json();
    if (!textResponse.ok) {
      throw new Error(textData?.error?.message || "Lỗi gọi API Groq.");
    }

    const aiText = textData?.choices?.[0]?.message?.content?.trim();
    if (!aiText) {
      throw new Error("Groq không trả về nội dung.");
    }

    // XỬ LÝ AUDIO MƯỢT MÀ NHƯ CŨ
    let audioBase64 = "";
    try {
      const lines = aiText.split('\n');
      const audioBuffers = [];

      for (let line of lines) {
        line = line.trim();
        if (!line) continue;

        const hasChinese = /[\u4e00-\u9fff]/.test(line);
        let cleanText = line.replace(/[*_#]/g, "");

        if (hasChinese) {
          cleanText = cleanText.replace(/\(.*?\)/g, "").trim();
        }

        if (cleanText.length < 2) continue;

        const langParam = hasChinese ? 'zh-CN' : 'vi';
        const textToEncode = encodeURIComponent(cleanText.substring(0, 200));
        const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&client=gtx&tl=${langParam}&q=${textToEncode}`;
        
        const audioResponse = await fetch(ttsUrl, {
          headers: { "User-Agent": "Mozilla/5.0" }
        });

        if (audioResponse.ok) {
          const arrayBuffer = await audioResponse.arrayBuffer();
          audioBuffers.push(Buffer.from(arrayBuffer));
        }
      }

      if (audioBuffers.length > 0) {
        const combinedBuffer = Buffer.concat(audioBuffers);
        audioBase64 = combinedBuffer.toString('base64');
      }
    } catch (ttsError) {
      console.warn("Lỗi Audio:", ttsError);
    }

    return res.status(200).json({
      result: aiText,          
      audioBase64: audioBase64 
    });

  } catch (error) {
    console.error("Lỗi Server:", error);
    return res.status(500).json({ error: error.message });
  }
};