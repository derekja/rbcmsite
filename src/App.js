import React, { useState, useEffect } from 'react';
import { Container, Row, Col, Card, Button, Modal, Form } from 'react-bootstrap';
import './App.css';
import DataService from './components/DataService';
import NovaSonicService from './components/NovaSonicService';
import SpeechInteraction from './components/SpeechInteraction';

function App() {
  // State for managing objects and UI
  const [objects, setObjects] = useState([]);
  const [selectedObject, setSelectedObject] = useState(null);
  const [showPromptModal, setShowPromptModal] = useState(false);
  const [editedPrompt, setEditedPrompt] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  
  // Initialize services
  const dataService = new DataService();
  const novaSonicService = new NovaSonicService('us-east-1');
  
  // Fetch images and prompts from Google sources
  useEffect(() => {
    const loadData = async () => {
      try {
        setIsLoading(true);
        const objectsData = await dataService.getObjectsData();
        setObjects(objectsData);
        setIsLoading(false);
      } catch (err) {
        console.error('Error loading data:', err);
        setError('Failed to load objects. Please refresh the page to try again.');
        setIsLoading(false);
      }
    };
    
    loadData();
  }, []);

  const handleSpeakClick = (object) => {
    setSelectedObject(object);
  };

  const handleEditPrompt = (object) => {
    setSelectedObject(object);
    setEditedPrompt(object.prompt);
    setShowPromptModal(true);
  };

  const handleSavePrompt = () => {
    if (selectedObject) {
      // Update the prompt in the local state
      const updatedObjects = objects.map(obj => 
        obj.id === selectedObject.id ? { ...obj, prompt: editedPrompt } : obj
      );
      setObjects(updatedObjects);
      
      // Update the prompt in the data service for persistence
      dataService.updateObjectPrompt(selectedObject.id, editedPrompt);
      
      setShowPromptModal(false);
    }
  };

  return (
    <div className="App">
      <Container fluid>
        <header className="App-header">
          <h1>RBCM Objects of Interest</h1>
          <p>Explore the Royal BC Museum's 100 objects of interest collection</p>
        </header>
        
        {isLoading ? (
          <div className="text-center my-5">
            <div className="spinner-border" role="status">
              <span className="visually-hidden">Loading...</span>
            </div>
            <p className="mt-2">Loading objects...</p>
          </div>
        ) : error ? (
          <div className="alert alert-danger">{error}</div>
        ) : (
          <Row className="g-4">
            {objects.map(object => (
              <Col key={object.id} xs={12} sm={6} md={4} lg={3}>
                <Card className="h-100">
                  <Card.Img variant="top" src={object.image || 'https://via.placeholder.com/300x300?text=Image+Not+Available'} alt={`${object.name || `Object ${object.id}`}`} />
                  <Card.Body className="d-flex flex-column">
                    <Card.Title>{object.name}</Card.Title>
                    <Card.Text className="mb-2">
                      {/* Show the first 50 characters of the prompt as a hint */}
                      {object.prompt ? `${object.prompt.substring(0, 50)}...` : 'No prompt available'}
                    </Card.Text>
                    <div className="mt-auto d-flex justify-content-between">
                      {selectedObject && selectedObject.id === object.id ? (
                        <SpeechInteraction 
                          object={object} 
                          novaSonicService={novaSonicService} 
                        />
                      ) : (
                        <Button 
                          variant="primary" 
                          onClick={() => handleSpeakClick(object)}
                        >
                          Speak
                        </Button>
                      )}
                      <Button 
                        variant="outline-secondary" 
                        onClick={() => handleEditPrompt(object)}
                      >
                        Edit Prompt
                      </Button>
                    </div>
                  </Card.Body>
                </Card>
              </Col>
            ))}
          </Row>
        )}
      </Container>

      {/* Prompt Edit Modal */}
      <Modal show={showPromptModal} onHide={() => setShowPromptModal(false)}>
        <Modal.Header closeButton>
          <Modal.Title>Edit Prompt</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form>
            <Form.Group>
              <Form.Label>Prompt</Form.Label>
              <Form.Control 
                as="textarea" 
                rows={5} 
                value={editedPrompt}
                onChange={(e) => setEditedPrompt(e.target.value)}
              />
            </Form.Group>
          </Form>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowPromptModal(false)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSavePrompt}>
            Save Changes
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
}

export default App;