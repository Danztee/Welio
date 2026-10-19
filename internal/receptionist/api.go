package receptionist

// settingsDTO is the stable REST shape. Settings itself keeps the existing
// persisted representation used by PostgreSQL and by the receptionist runtime.
type settingsDTO struct {
	Enabled           bool     `json:"enabled"`
	Greeting          string   `json:"greeting" maxLength:"240"`
	Instructions      string   `json:"instructions" maxLength:"2400"`
	FAQs              []faqDTO `json:"faqs" maxItems:"12"`
	AllowAvailability bool     `json:"allow_availability"`
	AllowBooking      bool     `json:"allow_booking"`
}

type faqDTO struct {
	Question string `json:"question" maxLength:"200"`
	Answer   string `json:"answer" maxLength:"1000"`
}

func settingsResponse(settings Settings) settingsDTO {
	result := settingsDTO{
		Enabled: settings.Enabled, Greeting: settings.Greeting,
		Instructions: settings.Instructions, AllowAvailability: settings.AllowAvailability,
		AllowBooking: settings.AllowBooking, FAQs: make([]faqDTO, 0, len(settings.FAQs)),
	}
	for _, faq := range settings.FAQs {
		result.FAQs = append(result.FAQs, faqDTO{Question: faq.Question, Answer: faq.Answer})
	}
	return result
}

func (dto settingsDTO) settings() Settings {
	settings := Settings{
		Enabled: dto.Enabled, Greeting: dto.Greeting, Instructions: dto.Instructions,
		AllowAvailability: dto.AllowAvailability, AllowBooking: dto.AllowBooking,
		FAQs: make([]FAQ, 0, len(dto.FAQs)),
	}
	for _, faq := range dto.FAQs {
		settings.FAQs = append(settings.FAQs, FAQ{Question: faq.Question, Answer: faq.Answer})
	}
	return settings
}
