class MonitoringService {
  constructor() {
    this.metrics = {
      requests: 0,
      errors: 0,
      activeUsers: new Set(),
      requestTimes: [],
      lastReset: new Date()
    };
    console.log('📊 Monitoring Service initialized');
  }

  trackRequest(phoneNumber) {
    this.metrics.requests++;
    if (phoneNumber) {
      this.metrics.activeUsers.add(phoneNumber);
    }
  }

  trackError(error) {
    this.metrics.errors++;
    console.error('📊 Tracked error:', error.message);
  }

  trackRequestTime(duration) {
    this.metrics.requestTimes.push(duration);
    // Keep only last 1000 request times
    if (this.metrics.requestTimes.length > 1000) {
      this.metrics.requestTimes.shift();
    }
  }

  getMetrics() {
    const avgTime = this.metrics.requestTimes.length > 0
      ? this.metrics.requestTimes.reduce((a, b) => a + b, 0) / this.metrics.requestTimes.length
      : 0;

    const uptime = Math.floor((Date.now() - this.metrics.lastReset.getTime()) / 1000);

    return {
      totalRequests: this.metrics.requests,
      totalErrors: this.metrics.errors,
      activeUsers: this.metrics.activeUsers.size,
      avgResponseTime: avgTime.toFixed(2) + 'ms',
      errorRate: this.metrics.requests > 0 
        ? ((this.metrics.errors / this.metrics.requests) * 100).toFixed(2) + '%'
        : '0%',
      uptime: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`,
      lastReset: this.metrics.lastReset.toISOString()
    };
  }

  reset() {
    this.metrics = {
      requests: 0,
      errors: 0,
      activeUsers: new Set(),
      requestTimes: [],
      lastReset: new Date()
    };
    console.log('📊 Metrics reset');
  }
}

module.exports = new MonitoringService();
