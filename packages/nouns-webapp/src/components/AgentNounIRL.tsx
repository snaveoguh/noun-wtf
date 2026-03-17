import React from 'react';

const AgentNounIRL: React.FC = () => {
  const [userQuestion, setUserQuestion] = React.useState('');
  const [answer, setAnswer] = React.useState('');

  const handleUserInput = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setUserQuestion(event.target.value);
  };

  const handleGetAnswer = () => {
    // Add logic to get answer from nounirl.eth
    setAnswer('Answer from nounirl.eth');
  };

  return (
    <div>
      <h1>Agent NounIRL</h1>
      <textarea value={userQuestion} onChange={handleUserInput} />
      <button onClick={handleGetAnswer}>Get Answer</button>
      <p>Answer: {answer}</p>
    </div>
  );
};

export default AgentNounIRL;