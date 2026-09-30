import React, { useState } from 'react';
import LayoutParserPage from '../layout/LayoutParserPage';
import MonitoringTab from './MonitoringTab';
import LayoutValidationTab from './LayoutValidationTab';
import UsersTab from './UsersTab';
import AiMetricsPanel from '../aiMetrics/AiMetricsPanel';
import './AdminPage.css';

const AdminPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<
    'processing' | 'monitoring' | 'validation' | 'aiMetrics' | 'users'
  >('processing');

  return (
    <div className="admin-page">
      <div className="admin-header">
        <h1>Painel Administrativo</h1>
        <div className="admin-tabs">
          <button
            type="button"
            className={`admin-tab ${activeTab === 'processing' ? 'active' : ''}`}
            onClick={() => setActiveTab('processing')}
          >
            Processamento
          </button>
          <button
            type="button"
            className={`admin-tab ${activeTab === 'monitoring' ? 'active' : ''}`}
            onClick={() => setActiveTab('monitoring')}
          >
            Monitoramento
          </button>
          <button
            type="button"
            className={`admin-tab ${activeTab === 'validation' ? 'active' : ''}`}
            onClick={() => setActiveTab('validation')}
          >
            Validação de Layouts
          </button>
          <button
            type="button"
            className={`admin-tab ${activeTab === 'aiMetrics' ? 'active' : ''}`}
            onClick={() => setActiveTab('aiMetrics')}
          >
            Métricas IA
          </button>
          <button
            type="button"
            className={`admin-tab ${activeTab === 'users' ? 'active' : ''}`}
            onClick={() => setActiveTab('users')}
          >
            Usuários
          </button>
        </div>
      </div>

      <div className="admin-content">
        {activeTab === 'processing' && (
          <div className="admin-tab-content">
            <LayoutParserPage />
          </div>
        )}

        {activeTab === 'monitoring' && (
          <div className="admin-tab-content">
            <MonitoringTab />
          </div>
        )}

        {activeTab === 'validation' && (
          <div className="admin-tab-content">
            <LayoutValidationTab />
          </div>
        )}

        {activeTab === 'aiMetrics' && (
          <div className="admin-tab-content">
            <AiMetricsPanel />
          </div>
        )}

        {activeTab === 'users' && (
          <div className="admin-tab-content">
            <UsersTab />
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminPage;
