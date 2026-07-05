import React, { useState } from 'react';
import { useFetch } from '../hooks/usePolling';
import { projectsApi, queuesApi, type Project, type Queue } from '../api/client';
import { useNavigate } from 'react-router-dom';

export default function Projects() {
  const navigate = useNavigate();
  const { data: projectsData, isLoading, error, refetch } = useFetch(() => projectsApi.list());
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setCreateError('');
    try {
      await projectsApi.create({ name: newName });
      setNewName('');
      setShowCreate(false);
      refetch();
    } catch (err: any) {
      setCreateError(err.message);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!window.confirm(`Delete project "${name}"? This will delete all queues and jobs.`)) return;
    try {
      await projectsApi.delete(id);
      refetch();
    } catch (err: any) {
      alert(err.message);
    }
  };

  return (
    <div style={{ padding: '2rem' }} className="fade-in">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', margin: 0 }}>Projects</h1>
          <p style={{ color: 'var(--text-secondary)', marginTop: '0.25rem', fontSize: '0.875rem' }}>
            Organize your queues by project
          </p>
        </div>
        <button className="btn btn-primary" id="create-project-btn" onClick={() => setShowCreate(true)}>
          + New Project
        </button>
      </div>

      {error && <div className="alert alert-error" style={{ marginBottom: '1rem' }}>{error}</div>}

      {isLoading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '4rem' }}>
          <div className="spinner" style={{ width: 32, height: 32 }} />
        </div>
      ) : projectsData?.data.length === 0 ? (
        <div className="empty-state card">
          <div className="empty-icon">📁</div>
          <p style={{ fontWeight: 600 }}>No projects yet</p>
          <p style={{ fontSize: '0.875rem' }}>Create your first project to start managing queues.</p>
          <button className="btn btn-primary" style={{ marginTop: '1rem' }} onClick={() => setShowCreate(true)}>
            Create Project
          </button>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1rem' }}>
          {projectsData?.data.map((project: Project) => (
            <ProjectCard
              key={project.id}
              project={project}
              onView={() => navigate(`/projects/${project.id}`)}
              onDelete={() => handleDelete(project.id, project.name)}
            />
          ))}
        </div>
      )}

      {/* Create modal */}
      {showCreate && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setShowCreate(false)}>
          <div className="modal">
            <div className="modal-header">
              <h2 style={{ margin: 0, fontSize: '1.25rem' }}>New Project</h2>
              <button onClick={() => setShowCreate(false)} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '1.25rem' }}>✕</button>
            </div>
            {createError && <div className="alert alert-error" style={{ marginBottom: '1rem' }}>{createError}</div>}
            <form onSubmit={handleCreate}>
              <div className="form-group">
                <label htmlFor="project-name">Project Name</label>
                <input
                  id="project-name"
                  type="text"
                  className="input"
                  placeholder="e.g. Email Service"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  required
                  autoFocus
                />
              </div>
              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={creating}>
                  {creating ? 'Creating...' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function ProjectCard({ project, onView, onDelete }: { project: Project; onView: () => void; onDelete: () => void }) {
  const { data: queues } = useFetch<Queue[]>(() => queuesApi.listByProject(project.id));

  return (
    <div className="card" style={{ cursor: 'pointer' }} onClick={onView}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h3 style={{ margin: '0 0 0.25rem', fontSize: '1.1rem' }}>{project.name}</h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.8125rem', margin: 0 }}>
            {queues?.length ?? 0} queue{queues?.length !== 1 ? 's' : ''}
          </p>
        </div>
        <button
          className="btn btn-danger btn-sm"
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          style={{ opacity: 0.7 }}
        >
          Delete
        </button>
      </div>
      <div style={{ marginTop: '1rem', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
        Created {new Date(project.created_at).toLocaleDateString()}
      </div>
    </div>
  );
}
