// scripts/test-database.ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function testDatabase() {
  console.log('🚀 开始测试数据库连接和功能...\n');

  try {
    // 1. 测试数据库连接
    console.log('1️⃣ 测试数据库连接...');
    await prisma.$connect();
    console.log('✅ 数据库连接成功\n');

    // 2. 创建测试文档
    console.log('2️⃣ 创建测试文档...');
    const testDocument = await prisma.document.create({
      data: {
        id: 'test-doc-001',
        title: '测试文档',
        content: 'This is a test document. It contains multiple sentences for testing purposes.',
        type: 'text',
        wordCount: 12,
        sentenceCount: 2,
        paragraphCount: 1,
        paragraphs: {
          create: [
            {
              id: 'test-para-001',
              content: 'This is a test document. It contains multiple sentences for testing purposes.',
              orderNum: 1,
              wordCount: 12,
              sentences: [
                'This is a test document.',
                'It contains multiple sentences for testing purposes.'
              ]
            }
          ]
        }
      },
      include: {
        paragraphs: true
      }
    });
    console.log('✅ 测试文档创建成功:', testDocument.title);
    console.log(`   - 段落数: ${testDocument.paragraphs.length}\n`);

    // 3. 创建测试语音记录
    console.log('3️⃣ 创建测试语音记录...');
    const testSpeech = await prisma.speechRecord.create({
      data: {
        id: 'test-speech-001',
        cacheKey: 'test_cache_key_001',
        fileName: 'test_speech_001',
        audioUrl: '/audio/test_speech_001.mp3',
        duration: 30,
        voiceId: 'Joanna',
        outputFormat: 'mp3',
        originalText: 'This is a test speech record.',
        wordCount: 6
      }
    });
    console.log('✅ 测试语音记录创建成功:', testSpeech.fileName);
    console.log(`   - 时长: ${testSpeech.duration}秒\n`);

    // 4. 查询测试
    console.log('4️⃣ 测试查询功能...');
    
    // 查询所有文档
    const documents = await prisma.document.findMany({
      include: {
        paragraphs: true
      }
    });
    console.log(`✅ 查询到 ${documents.length} 个文档`);

    // 查询所有语音记录
    const speeches = await prisma.speechRecord.findMany();
    console.log(`✅ 查询到 ${speeches.length} 个语音记录\n`);

    // 5. 更新测试
    console.log('5️⃣ 测试更新功能...');
    await prisma.paragraph.update({
      where: { id: 'test-para-001' },
      data: {
        audioUrl: '/audio/test_paragraph_001.mp3',
        audioFileName: 'test_paragraph_001',
        audioDuration: 25
      }
    });
    console.log('✅ 段落音频信息更新成功\n');

    // 6. 关联查询测试
    console.log('6️⃣ 测试关联查询...');
    const documentWithAudio = await prisma.document.findUnique({
      where: { id: 'test-doc-001' },
      include: {
        paragraphs: true
      }
    });
    console.log('✅ 关联查询成功');
    console.log(`   - 文档: ${documentWithAudio?.title}`);
    console.log(`   - 段落数: ${documentWithAudio?.paragraphs.length}`);
    console.log(`   - 第一段落音频: ${documentWithAudio?.paragraphs[0]?.audioUrl || '无'}\n`);

    // 7. 清理测试数据
    console.log('7️⃣ 清理测试数据...');
    await prisma.document.delete({
      where: { id: 'test-doc-001' }
    });
    await prisma.speechRecord.delete({
      where: { id: 'test-speech-001' }
    });
    console.log('✅ 测试数据清理完成\n');

    console.log('🎉 所有数据库功能测试通过！');

  } catch (error) {
    console.error('❌ 数据库测试失败:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
    console.log('🔌 数据库连接已关闭');
  }
}

// 运行测试
if (require.main === module) {
  testDatabase()
    .then(() => {
      console.log('\n✨ 测试完成');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 测试失败:', error);
      process.exit(1);
    });
}

export { testDatabase };