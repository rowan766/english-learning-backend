// scripts/test-api.ts
import axios from 'axios';

// 配置API基础URL（根据你的部署环境调整）
const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';

interface ApiTestResult {
  endpoint: string;
  method: string;
  success: boolean;
  statusCode?: number;
  error?: string;
  responseTime?: number;
}

class ApiTester {
  private results: ApiTestResult[] = [];

  async testEndpoint(
    endpoint: string, 
    method: 'GET' | 'POST' | 'DELETE',
    data?: any,
    description?: string
  ): Promise<void> {
    const startTime = Date.now();
    
    try {
      console.log(`🧪 测试 ${method} ${endpoint}${description ? ` - ${description}` : ''}`);
      
      let response;
      const url = `${API_BASE_URL}${endpoint}`;
      
      switch (method) {
        case 'GET':
          response = await axios.get(url);
          break;
        case 'POST':
          response = await axios.post(url, data);
          break;
        case 'DELETE':
          response = await axios.delete(url);
          break;
      }
      
      const responseTime = Date.now() - startTime;
      
      this.results.push({
        endpoint,
        method,
        success: true,
        statusCode: response.status,
        responseTime
      });
      
      console.log(`✅ 成功 - 状态码: ${response.status}, 响应时间: ${responseTime}ms`);
      
      // 打印部分响应数据
      if (response.data) {
        if (Array.isArray(response.data)) {
          console.log(`   📊 返回 ${response.data.length} 条记录`);
        } else if (response.data.id) {
          console.log(`   🆔 ID: ${response.data.id}`);
        }
      }
      
    } catch (error: any) {
      const responseTime = Date.now() - startTime;
      
      this.results.push({
        endpoint,
        method,
        success: false,
        statusCode: error.response?.status,
        error: error.message,
        responseTime
      });
      
      console.log(`❌ 失败 - ${error.response?.status || '网络错误'}: ${error.message}`);
    }
    
    console.log('');
  }

  printSummary(): void {
    console.log('📊 测试结果汇总:');
    console.log('=' .repeat(50));
    
    const successCount = this.results.filter(r => r.success).length;
    const totalCount = this.results.length;
    
    console.log(`总测试数: ${totalCount}`);
    console.log(`成功: ${successCount}`);
    console.log(`失败: ${totalCount - successCount}`);
    console.log(`成功率: ${((successCount / totalCount) * 100).toFixed(1)}%`);
    console.log('');
    
    // 显示失败的测试
    const failures = this.results.filter(r => !r.success);
    if (failures.length > 0) {
      console.log('❌ 失败的测试:');
      failures.forEach(failure => {
        console.log(`   ${failure.method} ${failure.endpoint} - ${failure.error}`);
      });
      console.log('');
    }
    
    // 显示响应时间统计
    const responseTimes = this.results
      .filter(r => r.responseTime)
      .map(r => r.responseTime!);
    
    if (responseTimes.length > 0) {
      const avgResponseTime = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
      const maxResponseTime = Math.max(...responseTimes);
      const minResponseTime = Math.min(...responseTimes);
      
      console.log('⏱️ 响应时间统计:');
      console.log(`   平均: ${avgResponseTime.toFixed(0)}ms`);
      console.log(`   最快: ${minResponseTime}ms`);
      console.log(`   最慢: ${maxResponseTime}ms`);
    }
  }
}

async function testAllApis() {
  console.log('🚀 开始API功能测试...\n');
  console.log(`🌐 API地址: ${API_BASE_URL}\n`);
  
  const tester = new ApiTester();
  
  // 测试文档相关API
  console.log('📄 测试文档API...');
  await tester.testEndpoint('/document', 'GET', null, '获取文档列表');
  
  // 创建测试文档
  const testDocumentData = {
    content: 'Hello world. This is a test document for API testing. It contains multiple sentences to verify the parsing functionality.',
    type: 'text',
    title: 'API测试文档'
  };
  
  await tester.testEndpoint('/document/process-text', 'POST', testDocumentData, '处理文本内容');
  
  // 测试语音相关API  
  console.log('🎵 测试语音API...');
  await tester.testEndpoint('/speech', 'GET', null, '获取语音记录列表');
  
  // 创建测试语音
  const testSpeechData = {
    text: 'Hello, this is a test speech for API testing.',
    voiceId: 'Joanna',
    outputFormat: 'mp3'
  };
  
  await tester.testEndpoint('/speech/generate', 'POST', testSpeechData, '生成语音');
  
  // 测试健康检查
  console.log('💚 测试健康检查...');
  await tester.testEndpoint('/health', 'GET', null, '健康检查');
  await tester.testEndpoint('/', 'GET', null, '根路径');
  
  // 测试分页
  console.log('📄 测试分页功能...');
  await tester.testEndpoint('/document?page=1&limit=5', 'GET', null, '分页查询文档');
  await tester.testEndpoint('/speech?page=1&limit=5', 'GET', null, '分页查询语音');
  
  console.log('🏁 API测试完成\n');
  tester.printSummary();
}

// 运行测试
if (require.main === module) {
  testAllApis()
    .then(() => {
      console.log('\n✨ API测试完成');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 API测试失败:', error);
      process.exit(1);
    });
}

export { testAllApis };