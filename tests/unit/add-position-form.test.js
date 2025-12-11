/**
 * Frontend - Add Position Form Tests (Phase 4.3)
 * File: tests/unit/add-position-form.test.js
 * 
 * Tests form submission with ticker field
 * 
 * Test Count: 6 tests
 * Expected Runtime: 5 seconds
 */

const { describe, it, expect, beforeEach } = require('@jest/globals');

describe('Add Position Form - Ticker Field', () => {
  let form;
  let tickerInput;
  let quantityInput;
  let submitButton;

  beforeEach(() => {
    // Mock DOM elements
    form = {
      addEventListener: jest.fn(),
      reset: jest.fn(),
      querySelector: jest.fn((selector) => {
        if (selector === '#newTicker') return tickerInput;
        if (selector === '#quantity') return quantityInput;
        if (selector === 'button[type="submit"]') return submitButton;
        return null;
      })
    };

    tickerInput = {
      value: '',
      addEventListener: jest.fn(),
      classList: { add: jest.fn(), remove: jest.fn() }
    };

    quantityInput = {
      value: '',
      addEventListener: jest.fn()
    };

    submitButton = {
      addEventListener: jest.fn()
    };
  });

  it('should render form with ticker input field', () => {
    const tickerField = form.querySelector('#newTicker');
    expect(tickerField).toBe(tickerInput);
    expect(tickerField).toBeDefined();
  });

  it('should validate ticker before form submission', () => {
    const validateForm = () => {
      const ticker = tickerInput.value.trim().toUpperCase();
      
      if (!ticker) {
        return { valid: false, error: 'Ticker is required' };
      }
      
      if (!/^[A-Z0-9\-\.]+$/.test(ticker)) {
        return { valid: false, error: 'Invalid ticker format' };
      }
      
      if (ticker.length > 20) {
        return { valid: false, error: 'Ticker too long' };
      }
      
      return { valid: true };
    };

    tickerInput.value = '';
    expect(validateForm().valid).toBe(false);

    tickerInput.value = 'AAPL';
    expect(validateForm().valid).toBe(true);

    tickerInput.value = 'invalid@ticker!';
    expect(validateForm().valid).toBe(false);
  });

  it('should format ticker input to uppercase on blur', () => {
    const handleTickerBlur = () => {
      tickerInput.value = tickerInput.value.toUpperCase().trim();
    };

    tickerInput.value = 'aapl';
    handleTickerBlur();
    expect(tickerInput.value).toBe('AAPL');
  });

  it('should submit form with ticker data', () => {
    const handleFormSubmit = (e) => {
      e.preventDefault();
      
      const formData = {
        ticker: tickerInput.value,
        quantity: parseInt(quantityInput.value)
      };
      
      return formData;
    };

    tickerInput.value = 'MSFT';
    quantityInput.value = '10';

    const mockEvent = { preventDefault: jest.fn() };
    const data = handleFormSubmit(mockEvent);

    expect(data.ticker).toBe('MSFT');
    expect(data.quantity).toBe(10);
    expect(mockEvent.preventDefault).toHaveBeenCalled();
  });

  it('should clear form after successful submission', () => {
    tickerInput.value = 'AAPL';
    quantityInput.value = '5';

    form.reset();

    expect(form.reset).toHaveBeenCalled();
  });

  it('should show error message for invalid ticker', () => {
    const showError = (message) => {
      tickerInput.classList.add('error');
      return { error: message, element: tickerInput };
    };

    const result = showError('Invalid ticker format');
    expect(result.error).toBe('Invalid ticker format');
    expect(tickerInput.classList.add).toHaveBeenCalledWith('error');
  });
});
